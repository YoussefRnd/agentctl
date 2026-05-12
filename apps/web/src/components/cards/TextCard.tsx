export function TextCard({ content }: { content: string }) {
  return (
    <div className="p-4 border-l-2 border-accent bg-surface/30 my-2">
      <div className="text-sm">{content}</div>
    </div>
  );
}
