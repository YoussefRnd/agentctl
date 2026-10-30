import type { ReviewContextReport, CodeReviewRun } from '@agentctl/shared';

const roles = {
  changed: 'Changed code',
  dependency: 'Dependency',
  reference: 'Caller / reference',
  test: 'Test source',
  guidance: 'Project guidance',
};
export function CodeReviewContext({
  context,
  status,
}: {
  context?: ReviewContextReport | null;
  status: CodeReviewRun['status'];
}) {
  if (!context) return null;
  const files = new Set(context.files.map((file) => file.path)).size;
  const limited =
    context.omittedCount > 0 ||
    context.indexTruncated ||
    context.searchTruncated ||
    !context.files.length;
  return (
    <details className="text-text-muted">
      <summary className="hover:text-text-main w-fit cursor-pointer py-0.5 text-[11px]">
        {status === 'completed' ? 'Context provided' : 'Prepared context'} · {files}{' '}
        {files === 1 ? 'file' : 'files'}
        {limited ? ' · Limited' : ''}
      </summary>
      <div className="border-border/40 mt-2 space-y-3 border-l pl-3 text-[11px]">
        <p className="leading-relaxed">
          Source context assembled from the captured versions. These files and line ranges form the
          review input; inclusion does not prove that every issue was detected.
        </p>
        {context.files.length > 0 && (
          <ul aria-label="Provided review context" className="space-y-2.5">
            {context.files.map((file) => (
              <li key={`${file.side}:${file.path}`} className="min-w-0 space-y-0.5">
                <p className="text-text-main font-mono [overflow-wrap:anywhere]">{file.path}</p>
                <p className="leading-relaxed">
                  {roles[file.role]} ·{' '}
                  {file.side === 'before' ? 'Before changes' : 'Current snapshot'} ·{' '}
                  {file.complete
                    ? 'Full file'
                    : file.ranges
                        .map((range) =>
                          range.startLine === range.endLine
                            ? `Line ${range.startLine}`
                            : `Lines ${range.startLine}–${range.endLine}`,
                        )
                        .join(', ')}
                </p>
              </li>
            ))}
          </ul>
        )}
        {context.omittedCount > 0 && (
          <div className="space-y-1.5">
            <p className="text-warning font-medium">
              {context.omittedCount} context{' '}
              {context.omittedCount === 1 ? 'candidate omitted' : 'candidates omitted'}
            </p>
            <ul aria-label="Omitted review context" className="space-y-1.5">
              {context.omitted.map((file, index) => (
                <li key={`${file.side}:${file.path}:${index}`} className="[overflow-wrap:anywhere]">
                  <span className="font-mono">{file.path}</span>
                  <span className="block">
                    {file.side === 'before' ? 'Before changes' : 'Current snapshot'} · {file.reason}
                  </span>
                </li>
              ))}
            </ul>
            {context.omittedCount > context.omitted.length && (
              <p>Additional omissions are summarized by the limits below.</p>
            )}
          </div>
        )}
        <ul
          aria-label="Review context limitations"
          className="list-disc space-y-1 pl-4 leading-relaxed"
        >
          {context.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
        <p className="text-text-muted/70">
          {context.indexedFiles.toLocaleString()} files indexed
          {context.indexTruncated ? ' (index limit reached)' : ''} ·{' '}
          {context.inputCharacters.toLocaleString()} prompt characters
        </p>
      </div>
    </details>
  );
}
