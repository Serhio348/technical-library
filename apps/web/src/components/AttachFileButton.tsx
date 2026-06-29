import { Paperclip } from "lucide-react";
import { useRef } from "react";

const ASK_ATTACHMENT_ACCEPT =
  ".pdf,.doc,.docx,.txt,.md,image/jpeg,image/jpg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isAskAttachmentFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 1) return false;
  return [".pdf", ".doc", ".docx", ".txt", ".md", ".jpg", ".jpeg", ".png"].includes(lower.slice(dot));
}

export function isImageAttachmentFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name);
}

export function AttachFileButton({
  onFileSelected,
  onHintChange,
  disabled,
  className = "",
  title = "Прикрепить файл (PDF, Word, фото…)",
}: {
  onFileSelected: (file: File) => void;
  onHintChange?: (message: string | null) => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePick = (): void => {
    if (disabled) return;
    inputRef.current?.click();
  };

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    if (!isAskAttachmentFile(file)) {
      onHintChange?.("Формат не поддерживается (PDF, DOC, DOCX, TXT, MD, JPEG, PNG).");
      return;
    }
    onFileSelected(file);
    onHintChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ASK_ATTACHMENT_ACCEPT}
        className="tl-visually-hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        className={`tl-icon-btn ${className}`.trim()}
        disabled={disabled}
        title={title}
        onClick={handlePick}
      >
        <Paperclip size={16} />
      </button>
    </>
  );
}
