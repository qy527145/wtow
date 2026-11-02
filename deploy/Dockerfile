# 服务端二进制在本地交叉编译成 x86_64-unknown-linux-musl 后随构建上下文上传，
# 服务器上只做一次 COPY，不需要 Rust 工具链。见 DESIGN 16.1。
# 构建上下文由 compose.yml 指定为 ./image，体积只有二进制本身。
FROM docker.1ms.run/library/alpine:3.20

# 二进制是静态链接的 musl 构建，不依赖 glibc。
COPY wtow-server /usr/local/bin/wtow-server

# tzdata 供 TZ=Asia/Shanghai 生效；ca-certificates 留给以后可能的出站 HTTPS。
RUN apk add --no-cache tzdata ca-certificates \
 && adduser -D -u 10001 -h /data wtow \
 && mkdir -p /data/attachments /data/releases \
 && chown -R wtow:wtow /data

USER wtow
WORKDIR /data
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/wtow-server"]
