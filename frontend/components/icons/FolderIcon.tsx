import React from "react";
import { Folder } from "lucide-react";

interface Props {
  className?: string;
  ariaLabel?: string;
}

const FolderIcon: React.FC<Props> = ({ className, ariaLabel = "folder" }) => {
  const cls = (className && className.trim()) || "w-4 h-4 text-amber-500";
  return <Folder aria-label={ariaLabel} className={cls} />;
};

export default FolderIcon;
