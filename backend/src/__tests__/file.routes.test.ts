import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "smart-scrape-files-"));
process.env.FILE_STORAGE_DIR = storageRoot;
process.env.DATABASE_URL ||=
  "postgresql://user:pass@localhost:5432/smartscrape_test";

type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function loadFileRoutes() {
  const [routes, prismaModule] = await Promise.all([
    import("../routes/file.routes"),
    import("../config/database"),
  ]);

  let prisma: any = prismaModule;
  while (prisma && !prisma.storedFile && prisma.default) prisma = prisma.default;

  return { router: routes.default, prisma };
}

async function startServer(): Promise<TestServer> {
  const { router } = await loadFileRoutes();
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err?.status || 500).json({ message: err?.message || "error" });
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

function replaceMethod(
  t: TestContext,
  target: any,
  name: string,
  replacement: (...args: any[]) => any,
) {
  const original = target[name];
  Object.defineProperty(target, name, { configurable: true, value: replacement });
  t.after(() => {
    Object.defineProperty(target, name, { configurable: true, value: original });
  });
}

async function withServer<T>(fn: (server: TestServer) => Promise<T>) {
  const server = await startServer();
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

async function jsonRequest(
  server: TestServer,
  pathName: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${server.baseUrl}${pathName}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => null),
  };
}

function fileRecord(overrides: Record<string, any> = {}): any {
  return {
    id: "file-1",
    fileName: "report.txt",
    mimeType: "text/plain",
    size: 12,
    description: "",
    uploaderId: "self",
    uploaderName: "You",
    storagePath: path.join(storageRoot, "report.txt"),
    uploadSessionId: null,
    sha256: null,
    contentHash: null,
    captureType: "UPLOAD",
    urlId: null,
    sourceUrl: null,
    tags: [],
    tagsMeta: null,
    visibility: "private",
    favoritesCount: 0,
    isFavorited: false,
    folderId: null,
    deletedAt: null,
    createdAt: new Date("2026-05-29T00:00:00.000Z"),
    updatedAt: new Date("2026-05-29T00:00:00.000Z"),
    ...overrides,
  };
}

function mockDocumentRevisionPrisma(t: TestContext, prisma: any) {
  replaceMethod(t, prisma.documentRevision, "findUnique", async () => null);
  replaceMethod(t, prisma.documentRevision, "aggregate", async () => ({
    _max: { ordinal: 0 },
  }));
  replaceMethod(t, prisma.documentRevision, "create", async () => ({
    id: "revision-1",
    documentId: "document-1",
  }));
  replaceMethod(t, prisma.document, "upsert", async () => ({ id: "document-1" }));
  replaceMethod(t, prisma.pipelineConfig, "createMany", async () => ({ count: 1 }));
  replaceMethod(t, prisma.pipelineConfig, "findUniqueOrThrow", async () => ({
    id: "pipeline-1",
    name: "upload.finalize",
    version: "test",
    configHash: "hash",
  }));
  replaceMethod(t, prisma.captureEvent, "upsert", async () => ({ id: "event-1" }));
}

test("chunk upload validates required fields and upload session ids", async () => {
  await withServer(async (server) => {
    const missing = new FormData();
    missing.set("chunk", new Blob(["hello"], { type: "text/plain" }), "0.part");
    const missingResponse = await fetch(`${server.baseUrl}/files/upload/chunk`, {
      method: "POST",
      body: missing,
    });
    assert.equal(missingResponse.status, 400);
    assert.deepEqual(await missingResponse.json(), {
      message: "Missing uploadSessionId or fileName",
    });

    const invalid = new FormData();
    invalid.set("uploadSessionId", "../bad");
    invalid.set("fileName", "report.txt");
    invalid.set("chunkIndex", "0");
    invalid.set("totalChunks", "1");
    invalid.set("chunk", new Blob(["hello"], { type: "text/plain" }), "0.part");
    const invalidResponse = await fetch(`${server.baseUrl}/files/upload/chunk`, {
      method: "POST",
      body: invalid,
    });
    assert.equal(invalidResponse.status, 400);
    assert.deepEqual(await invalidResponse.json(), {
      message: "Invalid uploadSessionId",
    });
  });
});

test("chunk upload cancel removes only normalized session directories", async () => {
  await withServer(async (server) => {
    const sessionId = "ABCDEF1234567890";
    const chunkDir = path.join(storageRoot, "chunks", sessionId.toLowerCase());
    fs.mkdirSync(chunkDir, { recursive: true });
    fs.writeFileSync(path.join(chunkDir, "0.part"), "partial");

    const response = await jsonRequest(server, `/files/upload/chunk/${sessionId}`, {
      method: "DELETE",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      ok: true,
      uploadSessionId: sessionId.toLowerCase(),
      removed: true,
    });
    assert.equal(fs.existsSync(chunkDir), false);
  });
});

test("manual upload finalize stitches chunks and persists sanitized metadata", async (t) => {
  const { prisma } = await loadFileRoutes();
  const sessionId = "uploadsession0001";
  const chunkDir = path.join(storageRoot, "chunks", sessionId);
  fs.mkdirSync(chunkDir, { recursive: true });
  fs.writeFileSync(path.join(chunkDir, "0.part"), "hello ");
  fs.writeFileSync(path.join(chunkDir, "1.part"), "world");

  const record = fileRecord({
    id: "stored-upload",
    fileName: "report.txt",
    storagePath: path.join(storageRoot, "uploads", `${sessionId}__report.txt`),
    uploadSessionId: sessionId,
    sha256: "sha",
  });

  replaceMethod(t, prisma.storedFile, "findUnique", async (args: any) => {
    if (args?.select?.tagsMeta) return { tagsMeta: null };
    return {
      id: record.id,
      urlId: null,
      captureType: "UPLOAD",
      captureScope: null,
      contentHash: null,
      sha256: record.sha256,
      sourceUrl: null,
    };
  });
  replaceMethod(t, prisma.storedFile, "upsert", async (args: any) => ({
    ...record,
    ...args.create,
    id: record.id,
  }));
  mockDocumentRevisionPrisma(t, prisma);

  await withServer(async (server) => {
    const response = await jsonRequest(server, "/files/finalize", {
      method: "POST",
      body: JSON.stringify({
        uploadSessionId: sessionId,
        fileName: "../report.txt",
        mimeType: "text/plain",
        description: "Final upload",
        folderId: "folder-1",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.id, "stored-upload");
    assert.equal(response.body.fileName, ".._report.txt");
    assert.equal(response.body.mimeType, "text/plain");
    assert.equal(fs.existsSync(chunkDir), false);
    assert.equal(fs.readFileSync(response.body.storagePath, "utf8"), "hello world");
  });
});

test("preview streams inline content and rejects unsupported previews", async (t) => {
  const { prisma } = await loadFileRoutes();
  const previewPath = path.join(storageRoot, "preview.txt");
  fs.writeFileSync(previewPath, "hello preview");

  replaceMethod(t, prisma.storedFile, "findUnique", async ({ where }: any) => {
    if (where.id === "preview") {
      return fileRecord({
        id: "preview",
        storagePath: previewPath,
        fileName: "preview.txt",
        mimeType: "text/plain",
      });
    }
    return fileRecord({
      id: "binary",
      storagePath: previewPath,
      fileName: "archive.bin",
      mimeType: "application/octet-stream",
    });
  });

  await withServer(async (server) => {
    const ok = await fetch(`${server.baseUrl}/files/preview/preview`);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-disposition") || "", /^inline;/);
    assert.equal(await ok.text(), "hello preview");

    const unsupported = await jsonRequest(server, "/files/binary/preview");
    assert.equal(unsupported.status, 415);
    assert.deepEqual(unsupported.body, {
      message: "Preview not supported for this file type",
    });
  });
});

test("file trash, restore, and permanent delete enforce lifecycle order", async (t) => {
  const { prisma } = await loadFileRoutes();
  const filePath = path.join(storageRoot, "delete-me.txt");
  fs.writeFileSync(filePath, "delete me");
  let current = fileRecord({ id: "file-life", storagePath: filePath });

  replaceMethod(t, prisma.storedFile, "findUnique", async () => current);
  replaceMethod(t, prisma.storedFile, "update", async ({ data }: any) => {
    current = { ...current, ...data };
    return current;
  });
  replaceMethod(t, prisma.storedFile, "delete", async () => current);

  await withServer(async (server) => {
    const prematureDelete = await jsonRequest(server, "/files/file-life", {
      method: "DELETE",
    });
    assert.equal(prematureDelete.status, 409);
    assert.equal(prematureDelete.body.code, "FILE_NOT_IN_TRASH");

    const trash = await jsonRequest(server, "/files/file-life/trash", {
      method: "PATCH",
    });
    assert.equal(trash.status, 200);
    assert.ok(trash.body.deletedAt);

    const restore = await jsonRequest(server, "/files/file-life/restore", {
      method: "PATCH",
    });
    assert.equal(restore.status, 200);
    assert.equal(restore.body.deletedAt, null);

    current = { ...current, deletedAt: new Date("2026-05-29T00:00:00.000Z") };
    const permanentDelete = await fetch(`${server.baseUrl}/files/file-life`, {
      method: "DELETE",
    });
    assert.equal(permanentDelete.status, 204);
    assert.equal(fs.existsSync(filePath), false);
  });
});

test("file CRUD updates metadata, moves to folders, renames, and duplicates content", async (t) => {
  const { prisma } = await loadFileRoutes();
  const sourcePath = path.join(storageRoot, "source.txt");
  fs.writeFileSync(sourcePath, "copy me");
  const existing = fileRecord({
    id: "file-crud",
    storagePath: sourcePath,
    fileName: "source.txt",
    tags: ["ai"],
    tagsMeta: { tagger: { aiTags: ["ai"] }, userTags: [] },
  });

  replaceMethod(t, prisma.folder, "findUnique", async ({ where }: any) =>
    where.id === "folder-1" ? { id: "folder-1", deletedAt: null } : null,
  );
  replaceMethod(t, prisma.storedFile, "findUnique", async () => existing);
  replaceMethod(t, prisma.storedFile, "update", async ({ data }: any) => ({
    ...existing,
    ...data,
    id: existing.id,
  }));
  replaceMethod(t, prisma.storedFile, "create", async ({ data }: any) => ({
    ...data,
    id: data.id,
  }));
  mockDocumentRevisionPrisma(t, prisma);

  await withServer(async (server) => {
    const patch = await jsonRequest(server, "/files/file-crud", {
      method: "PATCH",
      body: JSON.stringify({
        description: "updated",
        tags: ["user"],
        isFavorited: true,
        folderId: "folder-1",
      }),
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.description, "updated");
    assert.equal(patch.body.isFavorited, true);
    assert.equal(patch.body.favoritesCount, 1);
    assert.deepEqual(patch.body.userTags, ["user"]);
    assert.deepEqual(patch.body.aiTags, ["ai"]);
    assert.deepEqual(patch.body.effectiveTags, ["user", "ai"]);

    const move = await jsonRequest(server, "/files/file-crud/move", {
      method: "PUT",
      body: JSON.stringify({ folderId: "root" }),
    });
    assert.equal(move.status, 200);
    assert.equal(move.body.folderId, null);

    const duplicate = await jsonRequest(server, "/files/file-crud/duplicate", {
      method: "POST",
      body: JSON.stringify({ fileName: "copy.txt", folderId: "folder-1" }),
    });
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.fileName, "copy.txt");
    assert.equal(duplicate.body.folderId, "folder-1");

    const rename = await jsonRequest(server, "/files/file-crud/rename", {
      method: "PUT",
      body: JSON.stringify({ fileName: "renamed.md" }),
    });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.fileName, "renamed.md");
  });
});

test("folder CRUD validates parents, prevents cycles, and cascades trash/restore", async (t) => {
  const { prisma } = await loadFileRoutes();
  const folderRows = new Map<string, any>([
    ["parent", { id: "parent", name: "Parent", parentId: null, deletedAt: null }],
    ["child", { id: "child", name: "Child", parentId: "parent", deletedAt: null }],
  ]);
  const transactions: any[] = [];

  replaceMethod(t, prisma.folder, "create", async ({ data }: any) => ({
    id: "created",
    deletedAt: null,
    ...data,
  }));
  replaceMethod(t, prisma.folder, "findMany", async ({ where, include }: any) => {
    if (where?.parentId === "parent" && where?.select?.id) {
      return [{ id: "child" }];
    }
    if (where?.parentId === "child" && where?.select?.id) return [];
    const rows = [...folderRows.values()].filter((row) =>
      where?.parentId === undefined ? true : row.parentId === where.parentId,
    );
    return include?.children
      ? rows.map((row) => ({
          ...row,
          children: row.id === "parent" ? [{ id: "child" }] : [],
        }))
      : rows;
  });
  replaceMethod(t, prisma.folder, "findUnique", async ({ where, select }: any) => {
    const row = folderRows.get(where.id) || null;
    if (!row) return null;
    if (!select) return row;
    return Object.fromEntries(
      Object.keys(select).map((key) => [key, row[key] ?? null]),
    );
  });
  replaceMethod(t, prisma.folder, "update", async ({ where, data }: any) => {
    const row = { ...folderRows.get(where.id), ...data };
    folderRows.set(where.id, row);
    return row;
  });
  replaceMethod(t, prisma.folder, "updateMany", (args: any) => ({
    model: "folder",
    args,
  }));
  replaceMethod(t, prisma.storedFile, "updateMany", (args: any) => ({
    model: "storedFile",
    args,
  }));
  replaceMethod(t, prisma, "$transaction", async (ops: any[]) => {
    transactions.push(ops);
    return ops;
  });

  await withServer(async (server) => {
    const create = await jsonRequest(server, "/folders", {
      method: "POST",
      body: JSON.stringify({ name: "  Evidence  ", parentId: "parent" }),
    });
    assert.equal(create.status, 201);
    assert.equal(create.body.name, "Evidence");
    assert.equal(create.body.parentId, "parent");

    const list = await jsonRequest(server, "/folders?parentId=root");
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.map((folder: any) => ({
        id: folder.id,
        hasChildren: folder.hasChildren,
      })),
      [{ id: "parent", hasChildren: true }],
    );

    const cycle = await jsonRequest(server, "/folders/parent", {
      method: "PATCH",
      body: JSON.stringify({ parentId: "child" }),
    });
    assert.equal(cycle.status, 400);
    assert.deepEqual(cycle.body, { message: "Invalid move (cycle)" });

    const trash = await jsonRequest(server, "/folders/parent/trash", {
      method: "PATCH",
    });
    assert.equal(trash.status, 200);
    assert.deepEqual(trash.body, { ok: true });

    const restore = await jsonRequest(server, "/folders/parent/restore", {
      method: "PATCH",
    });
    assert.equal(restore.status, 200);
    assert.deepEqual(restore.body, { ok: true });

    assert.equal(transactions.length, 2);
  });
});
