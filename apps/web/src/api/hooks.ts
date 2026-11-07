import type {
  DupeScan,
  DupeScanRequest,
  FolderJobRequest,
  FolderListing,
  JobInfo,
  JobRequest,
  PlanResult,
  PublicConfig,
  RootName,
  Rule,
  Settings,
  TrashItem,
  TreeNode,
} from '@io/shared';
import { useMutation, useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, qs } from './client';

export const keys = {
  me: ['me'] as const,
  config: ['config'] as const,
  settings: ['settings'] as const,
  tree: (root: RootName, rel: string) => ['tree', root, rel] as const,
  folder: (root: RootName, rel: string, recursive: boolean) => ['folder', root, rel, recursive] as const,
  metadata: (root: RootName, rel: string) => ['metadata', root, rel] as const,
  jobs: ['jobs'] as const,
  trash: ['trash'] as const,
  rules: ['rules'] as const,
  importCount: ['importCount'] as const,
  dupes: (threshold?: number) => ['dupes', threshold ?? null] as const,
};

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<{ username: string }>('/api/auth/me'), retry: false, staleTime: Infinity });

export const useConfig = () => useQuery({ queryKey: keys.config, queryFn: () => api<PublicConfig>('/api/config'), staleTime: Infinity });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<Settings>('/api/settings') });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Settings) => api<Settings>('/api/settings', { method: 'PUT', body: s }),
    onSuccess: (s) => {
      qc.setQueryData(keys.settings, s);
      // Resolved dates, issues and template matches depend on settings.
      qc.invalidateQueries({ queryKey: ['folder'] });
      qc.invalidateQueries({ queryKey: keys.config });
    },
  });
}

export const useTree = (root: RootName, rel: string, enabled = true) =>
  useQuery({ queryKey: keys.tree(root, rel), queryFn: () => api<TreeNode[]>(`/api/tree?${qs({ root, rel })}`), enabled });

export const useFolder = (root: RootName, rel: string, recursive: boolean) =>
  useQuery({
    queryKey: keys.folder(root, rel, recursive),
    queryFn: () => api<FolderListing>(`/api/folder?${qs({ root, rel, recursive: recursive ? 1 : 0 })}`),
    placeholderData: (prev) => (prev && prev.root === root ? prev : undefined),
  });

export type TagGroups = Record<string, Record<string, unknown>>;

export const useMetadata = (root: RootName, rel: string | null) =>
  useQuery({
    queryKey: keys.metadata(root, rel ?? ''),
    queryFn: () => api<TagGroups>(`/api/metadata?${qs({ root, rel: rel! })}`),
    enabled: !!rel,
  });

/** All tags for several files at once (same cache entries as `useMetadata`). */
export const useMetadataMany = (files: { root: RootName; rel: string }[]) =>
  useQueries({
    queries: files.map((f) => ({
      queryKey: keys.metadata(f.root, f.rel),
      queryFn: () => api<TagGroups>(`/api/metadata?${qs({ root: f.root, rel: f.rel })}`),
    })),
  });

export const useJobs = () => useQuery({ queryKey: keys.jobs, queryFn: () => api<JobInfo[]>('/api/jobs') });
export const useTrash = () => useQuery({ queryKey: keys.trash, queryFn: () => api<TrashItem[]>('/api/trash') });
export const useRules = () => useQuery({ queryKey: keys.rules, queryFn: () => api<Rule[]>('/api/rules') });
export const useImportCount = () =>
  useQuery({ queryKey: keys.importCount, queryFn: () => api<{ count: number }>('/api/import/count'), refetchInterval: 30_000 });

/** The latest duplicate scan with its groups; `threshold` regroups a finished near/similar scan. */
export const useDupeScan = (threshold?: number) =>
  useQuery({
    queryKey: keys.dupes(threshold),
    queryFn: () => api<DupeScan | null>(`/api/dupes/scan?${qs({ threshold })}`),
    placeholderData: (prev) => prev,
  });
export const startDupeScan = (req: DupeScanRequest) => api<DupeScan>('/api/dupes/scan', { method: 'POST', body: req });
export const cancelDupeScan = () => api<DupeScan | null>('/api/dupes/cancel', { method: 'POST' });

export const planJob = (req: JobRequest) => api<PlanResult>('/api/jobs/plan', { method: 'POST', body: req });
export const submitJob = (req: JobRequest) => api<JobInfo>('/api/jobs', { method: 'POST', body: req });
/** Folder operations (Folders pane menu): same dry run → job flow as batch actions. */
export const planFolderJob = (req: FolderJobRequest) => api<PlanResult>('/api/folders/plan', { method: 'POST', body: req });
export const applyFolderJob = (req: FolderJobRequest) => api<JobInfo>('/api/folders/apply', { method: 'POST', body: req });
export const undoJob = (id: string) => api<JobInfo>(`/api/jobs/${id}/undo`, { method: 'POST' });
export const cancelJob = (id: string) => api<JobInfo>(`/api/jobs/${id}/cancel`, { method: 'POST' });

/** Submit a job and wait until it finishes; throws the first per-file error (for inline edits). */
export async function runJobAndWait(req: JobRequest): Promise<JobInfo> {
  const job = await waitForJob((await submitJob(req)).id);
  if (job.errors.length) throw new Error(job.errors[0].message);
  return job;
}

/** Poll a queued or running job until it finishes. */
export async function waitForJob(id: string): Promise<JobInfo> {
  for (;;) {
    const job = await api<JobInfo>(`/api/jobs/${id}`);
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** After any job finishes, files may have moved/changed everywhere: refresh what depends on them. */
export function invalidateFiles(qc: QueryClient) {
  for (const k of ['folder', 'tree', 'metadata', 'trash', 'importCount', 'rules', 'dupes']) qc.invalidateQueries({ queryKey: [k] });
}

/** Live job updates and duplicate-scan progress over SSE; keeps the query cache current. */
export function useJobEvents(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/events');
    es.addEventListener('job', (ev) => {
      const job = JSON.parse((ev as MessageEvent).data) as JobInfo;
      qc.setQueryData<JobInfo[]>(keys.jobs, (list = []) => {
        const rest = list.filter((j) => j.id !== job.id);
        return [job, ...rest].sort((a, b) => b.createdAt - a.createdAt);
      });
      if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') invalidateFiles(qc);
    });
    es.addEventListener('scan', (ev) => {
      const scan = JSON.parse((ev as MessageEvent).data) as DupeScan;
      // Progress carries no groups: keep the ones shown until the finished scan is fetched.
      qc.setQueriesData<DupeScan | null>({ queryKey: ['dupes'] }, (prev) => ({ ...scan, groups: prev?.id === scan.id ? prev.groups : [] }));
      if (scan.status !== 'running') qc.invalidateQueries({ queryKey: ['dupes'] });
    });
    return () => es.close();
  }, [enabled, qc]);
}
