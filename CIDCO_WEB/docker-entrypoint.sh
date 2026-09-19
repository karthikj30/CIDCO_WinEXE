#!/bin/sh
set -e

# Run Prisma schema push
echo "Running Prisma DB push..."
npx prisma db push

# Start the Next.js application
echo "Starting Next.js..."
exec "$@"
