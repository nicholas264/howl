import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function localApiPlugin(root) {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost')
        if (!requestUrl.pathname.startsWith('/api/')) return next()

        const apiPath = requestUrl.pathname.replace(/^\/api\//, '')
        if (!/^[a-zA-Z0-9/_-]+$/.test(apiPath)) return next()

        const filePath = path.join(root, 'api', `${apiPath}.js`)
        if (!existsSync(filePath)) return next()

        try {
          const chunks = []
          for await (const chunk of req) chunks.push(chunk)
          const rawBody = Buffer.concat(chunks).toString('utf8')
          const contentType = req.headers['content-type'] || ''

          req.query = Object.fromEntries(requestUrl.searchParams.entries())
          req.body = rawBody
          if (rawBody && contentType.includes('application/json')) {
            try {
              req.body = JSON.parse(rawBody)
            } catch {
              res.statusCode = 400
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ error: 'Invalid JSON body' }))
              return
            }
          }

          res.status = code => {
            res.statusCode = code
            return res
          }
          res.json = payload => {
            if (!res.headersSent) res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify(payload))
          }
          res.send = payload => {
            if (typeof payload === 'object' && payload !== null && !Buffer.isBuffer(payload)) return res.json(payload)
            res.end(payload)
          }

          const moduleUrl = `${pathToFileURL(filePath).href}?t=${Date.now()}`
          const mod = await import(moduleUrl)
          if (typeof mod.default !== 'function') return next()
          await mod.default(req, res)
        } catch (err) {
          server.ssrFixStacktrace(err)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  if (env.VITE_AUTH_DISABLED === 'true' && !process.env.AUTH_DISABLED) process.env.AUTH_DISABLED = 'true'
  if (!process.env.NODE_ENV) process.env.NODE_ENV = mode === 'production' ? 'production' : 'development'

  return {
    plugins: [react(), localApiPlugin(process.cwd())],
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
    },
  }
})
