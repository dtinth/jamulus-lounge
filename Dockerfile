FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY server/package.json server/yarn.lock /app/

# Install dependencies
RUN yarn install --frozen-lockfile --production

# Copy application files
COPY server/ /app/server/
COPY public/ /app/public/

# Set working directory for the application
WORKDIR /app/server

# Default command (can be overridden)
CMD ["node", "index.mjs"]
