FROM oven/bun:latest

WORKDIR /app

# Install build dependencies
# Build-essential for GCC/g++/make
# ca-certificates for HTTPS
RUN apt-get update && apt-get install -y \
    wget \
    build-essential \
    pkg-config \
    ca-certificates \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create temp directory for Bun builds
RUN mkdir -p /tmp/bun-build && chmod 777 /tmp/bun-build

CMD [ "bash" ]
