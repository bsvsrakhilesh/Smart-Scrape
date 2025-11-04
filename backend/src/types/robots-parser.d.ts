declare module 'robots-parser' {
  export default function robotsParser(
    url: string,
    body: string
  ): {
    isAllowed: (url: string, ua?: string) => boolean;
    isDisallowed: (url: string, ua?: string) => boolean;
  };
}
