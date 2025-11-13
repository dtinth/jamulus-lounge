# Use Node.js 20 on Alpine for a smaller image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY server/package.json server/yarn.lock ./server/

# Install dependencies
RUN cd server && yarn install --frozen-lockfile --production

# Copy application code
COPY server/ ./server/
COPY public/ ./public/

# Create directory for optional config
RUN mkdir -p /app/server

# Expose ports (can be overridden via environment variables)
# Default ports from env.mjs:
# - LOUNGE_SERVER_PORT: 9998 (public-facing server)
# - LOUNGE_ADMIN_PORT: 9996 (admin server)
# - LOUNGE_CLIPPER_PORT: 9997 (clipper server)
EXPOSE 9998 9996 9997

# Health check for the main server
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${LOUNGE_SERVER_PORT:-9998}/config', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1));"

# Set working directory to server for running commands
WORKDIR /app/server

# Use init to handle signals properly
# Default command runs the main server (can be overridden for clipper)
CMD ["node", "index.mjs"]
