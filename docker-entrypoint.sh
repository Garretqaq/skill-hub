#!/bin/sh
set -e

# 以 root 启动，确保 bind 挂载的 /data 可写（marketplace 克隆等运行时数据）
mkdir -p /data/marketplace

exec "$@"
