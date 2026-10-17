import { useState, useRef, useCallback } from 'react';
import type { useAttachments } from './useAttachments';
import type { useContextAutocomplete } from './useContextAutocomplete';

/** Routes clipboard/drop/file-input interactions to uploads or context references. */
export function useComposerFiles({
  addFiles,
  contextAutocomplete,
  supportsImageAttachments,
}: {
  addFiles: ReturnType<typeof useAttachments>['addFiles'];
  contextAutocomplete: ReturnType<typeof useContextAutocomplete>;
  supportsImageAttachments: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAttachClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        const files = Array.from(e.target.files);
        const imageFiles = files.filter((f) => f.type.startsWith('image/'));
        const otherFiles = files.filter((f) => !f.type.startsWith('image/'));

        if (supportsImageAttachments && imageFiles.length > 0) {
          addFiles(imageFiles);
        } else {
          // Images can't be uploaded for this agent — attach them as file context instead.
          for (const file of imageFiles) {
            const filePath = (file as { path?: string }).path || file.name;
            contextAutocomplete.selectItem({
              id: `file:${filePath}`,
              type: 'file',
              title: file.name,
              subtitle: filePath,
              value: filePath,
            });
          }
        }

        for (const file of otherFiles) {
          const filePath = (file as { path?: string }).path || file.name;
          contextAutocomplete.selectItem({
            id: `file:${filePath}`,
            type: 'file',
            title: file.name,
            subtitle: filePath,
            value: filePath,
          });
        }
      }
      e.target.value = '';
    },
    [addFiles, contextAutocomplete, supportsImageAttachments],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(e.clipboardData.items);
      const imageItems = items.filter((item) => item.type.startsWith('image/'));
      if (supportsImageAttachments && imageItems.length > 0) {
        e.preventDefault();
        const files = imageItems
          .map((item) => item.getAsFile())
          .filter((f): f is File => f !== null);
        addFiles(files);
      }
    },
    [addFiles, supportsImageAttachments],
  );

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const types = Array.from(e.dataTransfer?.types || []);
    if (types.includes('Files') || types.includes('text/uri-list')) {
      dragCounter.current += 1;
      if (dragCounter.current === 1) {
        setIsDraggingOver(true);
      }
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDraggingOver(false);
      const items = Array.from(e.dataTransfer.items || []);
      if (items.length > 0) {
        const imageFiles: File[] = [];
        for (const item of items) {
          if (item.kind !== 'file') continue;
          const entry = item.webkitGetAsEntry?.();
          const file = item.getAsFile();
          if (!file) continue;

          if (file.type.startsWith('image/')) {
            imageFiles.push(file);
          } else {
            const isDirectory = entry?.isDirectory ?? false;
            const filePath = (file as { path?: string }).path || file.name;
            const displayName = isDirectory
              ? file.name.endsWith('/')
                ? file.name
                : `${file.name}/`
              : file.name;

            contextAutocomplete.selectItem({
              id: isDirectory ? `folder:${filePath}` : `file:${filePath}`,
              type: isDirectory ? 'folder' : 'file',
              title: displayName,
              subtitle: filePath,
              value: filePath,
            });
          }
        }
        if (supportsImageAttachments && imageFiles.length > 0) {
          addFiles(imageFiles);
        }
      } else {
        const files = Array.from(e.dataTransfer.files);
        const imageFiles = files.filter((f) => f.type.startsWith('image/'));
        const otherFiles = files.filter((f) => !f.type.startsWith('image/'));

        if (supportsImageAttachments && imageFiles.length > 0) {
          addFiles(imageFiles);
        }

        for (const file of otherFiles) {
          const filePath = (file as { path?: string }).path || file.name;
          contextAutocomplete.selectItem({
            id: `file:${filePath}`,
            type: 'file',
            title: file.name,
            subtitle: filePath,
            value: filePath,
          });
        }
      }
    },
    [addFiles, contextAutocomplete, supportsImageAttachments],
  );

  return {
    fileInputRef,
    handleAttachClick,
    handleFileInputChange,
    handlePaste,
    handleDrop,
    isDraggingOver,
    handleDragEnter,
    handleDragLeave,
  };
}
