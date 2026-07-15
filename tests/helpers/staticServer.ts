import { createServer, Server } from 'http'
import { readFile } from 'fs/promises'
import { join } from 'path'

export interface TestServer {
  url: string
  close: () => Promise<void>
}

/** Minimal static file server for the Playwright fixture pages - avoids depending on any live site in tests. */
export function startFixtureServer(fixturesDir: string): Promise<TestServer> {
  const server: Server = createServer((req, res) => {
    const filePath = join(
      fixturesDir,
      (req.url ?? '/').split('?')[0] === '/' ? 'testpage.html' : (req.url ?? '')
    )
    readFile(filePath)
      .then((content) => {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(content)
      })
      .catch(() => {
        res.writeHead(404)
        res.end('not found')
      })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      })
    })
  })
}
