import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { DATA_DIR } from '../media/moderation.ts'
import type { PoolBackend } from './store.ts'

const POOL_KEY = 'prompt-pool.json'

// R2 — but NOT the assets bucket. That one is public (players load images
// straight from its r2.dev URL), so a pool stored there could be read by
// anyone, code or no code. The prompt pool needs its own private bucket.
class R2PoolBackend implements PoolBackend {
  readonly name = 'r2'
  private readonly client: S3Client

  constructor(
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly bucket: string,
    private readonly key: string,
    private readonly contentType: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  async load(): Promise<string | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key }))
      return (await res.Body?.transformToString('utf8')) ?? null
    } catch (err) {
      // nothing stored yet is an empty pool; anything else is an outage
      if (err instanceof Error && err.name === 'NoSuchKey') return null
      throw err
    }
  }

  async save(json: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key, Body: json, ContentType: this.contentType }),
    )
  }
}

// a file next to the other server data — dev, or a server without a
// private bucket configured
class LocalPoolBackend implements PoolBackend {
  readonly name = 'local'
  private readonly file: string

  constructor(key: string) {
    this.file = path.join(DATA_DIR, key)
  }

  async load(): Promise<string | null> {
    try {
      return await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }

  async save(json: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(`${this.file}.tmp`, json)
    await rename(`${this.file}.tmp`, this.file)
  }
}

// One object in the private bucket (or a file in the data dir) — the
// prompt pool, and the asset labels (see labels/).
export function createPrivateBackend(key: string, contentType: string): PoolBackend {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PROMPTS_BUCKET } = process.env
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PROMPTS_BUCKET) {
    return new R2PoolBackend(R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PROMPTS_BUCKET, key, contentType)
  }
  return new LocalPoolBackend(key)
}

export function createPoolBackend(): PoolBackend {
  return createPrivateBackend(POOL_KEY, 'application/json')
}
