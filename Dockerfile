# Use an official Node.js runtime as a parent image (Choose a specific LTS version)
# Check Node version compatibility if needed, Node 20 LTS is a good default
FROM node:20-alpine AS builder

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy the rest of the application code (including compiled JS)
# First, copy the compiled code from the temporary build stage
COPY . .

# Build the TypeScript code (ensure src is copied)
RUN npm run build

# --- Second Stage: Production Image ---
FROM node:20-alpine

WORKDIR /usr/src/app

# Copy dependency lock files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built application from builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Copy the .env file - IMPORTANT: This includes secrets in the image layer.
# For better security in production, manage secrets via environment variables instead.
# COPY .env ./.env 
# If not copying .env, ensure all required ENV vars (TWENTY_API_URL, TWENTY_API_TOKEN, PORT) 
# are provided when running the container.

# Make port 3002 available to the world outside this container
EXPOSE 3002

# Define environment variable (optional, PORT can also be set by .env or runtime)
ENV PORT=3002

# Define the command to run your app
CMD [ "node", "dist/index.js" ] 