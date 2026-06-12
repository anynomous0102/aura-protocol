import { Paperclip, Send } from "lucide-react";
import type { ChangeEvent, DragEvent, ReactElement } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import FilePill from "./FilePill";

interface InputBarProps {
  onSubmit: (message: string, files: File[]) => void;
  isLoading: boolean;
}

const MAX_FILES = 4;

export default function InputBar({ onSubmit, isLoading }: InputBarProps): ReactElement {
  const [message, setMessage] = useState("");
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: File[]): void => {
    const combined = [...uploadedFiles, ...files];
    if (combined.length > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} files allowed. Remove a file to add another.`);
      return;
    }
    setUploadedFiles(combined);
  };

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>): void => {
    const selected = Array.from(event.target.files ?? []);
    addFiles(selected);
    event.target.value = "";
  };

  const removeFile = (fileName: string): void => {
    setUploadedFiles((prev) => prev.filter((file) => file.name !== fileName));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };

  const submit = (): void => {
    const trimmed = message.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed, uploadedFiles);
    setMessage("");
    setUploadedFiles([]);
  };

  return (
    <div
      className={`flex w-full flex-col gap-2 rounded-xl border p-2 transition-colors ${
        isDragging ? "border-dashed border-sky-400 bg-sky-400/10" : "border-neutral-700 bg-neutral-950"
      }`}
      onDragEnter={() => setIsDragging(true)}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-2" role="list" aria-label="Attached files">
          {uploadedFiles.map((file) => (
            <FilePill key={`${file.name}-${file.size}-${file.lastModified}`} file={file} onRemove={removeFile} />
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800"
          aria-label="Attach files"
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip size={18} />
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
        <textarea
          className="min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
          value={message}
          placeholder="Ask AURA..."
          rows={1}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-sky-400 text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Send message"
          disabled={isLoading || !message.trim()}
          onClick={submit}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}

export type { InputBarProps };
