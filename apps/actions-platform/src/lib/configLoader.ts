import { readFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';

type LoaderOpts = { manifestPath: URL; watch?: boolean };

export type ConfigBundle = {
  manifest: any;
  toolManifest: any;
  canonicalModel: any;
  schemas: Record<string, any>;
};

export function resolvePath(url: URL, rel: string): string {
  const base = path.resolve(path.dirname(url.pathname));
  return path.resolve(base, rel);
}

export async function createConfigLoader(opts: LoaderOpts) {
  let bundle = await loadAll(opts.manifestPath);

  if (opts.watch) {
    const dir = path.dirname(opts.manifestPath.pathname);
    watch(dir, { recursive: true }, async (_eventType, _filename) => {
      try {
        bundle = await loadAll(opts.manifestPath);
        // eslint-disable-next-line no-console
        console.log('Config bundle reloaded');
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Config reload failed', e);
      }
    });
  }

  return {
    getBundle: () => bundle
  };
}

async function loadAll(manifestPath: URL): Promise<ConfigBundle> {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
  const toolManifestPath = resolvePath(manifestPath, manifest.tools_manifest);
  const canonicalModelPath = resolvePath(manifestPath, manifest.canonical_model);
  const schemas = Object.fromEntries(
    await Promise.all(
      Object.entries(manifest.schemas).map(async ([k, v]: any) => [k, JSON.parse(await readFile(resolvePath(manifestPath, v), 'utf-8'))])
    )
  );
  const toolManifest = JSON.parse(await readFile(toolManifestPath, 'utf-8'));
  const canonicalModel = JSON.parse(await readFile(canonicalModelPath, 'utf-8'));
  return { manifest, toolManifest, canonicalModel, schemas };
}


