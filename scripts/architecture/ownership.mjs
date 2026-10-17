/** Coverage is explicit: additions, deletions and duplicate assignments require ledger review. */
export function ownershipErrors(files, areas) {
  const errors = [];
  const sources = new Set(files);
  const assigned = new Set();
  for (const area of areas) {
    if (!area.owner?.trim() || !area.evidence?.trim())
      errors.push('Ownership area requires an owner and evidence');
    for (const file of area.files) {
      if (assigned.has(file)) errors.push(`Duplicate owner: ${file}`);
      assigned.add(file);
      if (!sources.has(file)) errors.push(`Remove stale ownership entry: ${file}`);
    }
  }
  for (const file of sources)
    if (!assigned.has(file)) errors.push(`File needs an owner and acceptance evidence: ${file}`);
  return errors;
}
