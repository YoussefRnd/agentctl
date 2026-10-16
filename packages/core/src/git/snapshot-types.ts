export interface FilePatch {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

export interface SnapshotFileChange extends FilePatch {
  additions: number;
  deletions: number;
}

export interface SnapshotComparison {
  files: SnapshotFileChange[];
  totalAdditions: number;
  totalDeletions: number;
}
