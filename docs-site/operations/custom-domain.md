# 自定义域名（Custom Domain）

docs-site 默认部署在 GitHub Pages 的 project URL：
`https://crlcrl00.github.io/resume-app/`

挂载自有域名后，站点将从域名根路径（`/`）提供服务。本页说明启用步骤。

## 1. 修改 CNAME 文件

编辑 `docs-site/CNAME`，把占位值改成你的真实域名（一行、无协议、无斜杠）：

```
docs.example.com
```

> ⚠️ 仓库里提交的是占位域名 `docs.example.com`。请本地改成真实域名后再提交（真域名由仓库拥有者控制）。

CI（`.github/workflows/docs-deploy.yml`）会在构建后把该文件拷进 `dist/CNAME`，
GitHub Pages 读取 `dist` 根目录的 `CNAME` 作为自定义域。

## 2. GitHub Pages 设置

repo → **Settings → Pages**：

- **Source**：GitHub Actions（首次部署必须手动选一次）
- **Custom domain**：填入 `docs.example.com` → Save
- 等待 DNS 校验通过后，勾选 **Enforce HTTPS**（强制 HTTPS）

## 3. DNS 配置

在域名 DNS 服务商处添加记录：

| 类型  | 主机记录 | 记录值                  |
| ----- | -------- | ----------------------- |
| CNAME | `docs`   | `crlcrl00.github.io`    |

> 若使用根域（apex，如 `example.com`）而非子域，需改用 A 记录指向 GitHub Pages 的
> IP（`185.199.108.153` 等 4 个），并可选 AAAA。子域用 CNAME 更简单，推荐。

DNS 生效后 GitHub 会自动签发 Let's Encrypt 证书（几分钟到 24h）。

## 4. 本地测试（可选）

无需等 DNS，可本地模拟：

1. 改 hosts 把域名指向本机：

   ```
   127.0.0.1  docs.example.com
   ```

   - macOS/Linux：`/etc/hosts`
   - Windows：`C:\Windows\System32\drivers\etc\hosts`

2. 用 [mkcert](https://github.com/FiloSottile/mkcert) 生成本地可信自签证书：

   ```bash
   mkcert -install
   mkcert docs.example.com
   ```

3. 用带 TLS 的静态服务器指向构建产物：

   ```bash
   cd docs-site && npm run build
   npx serve .vitepress/dist   # 或用 caddy / nginx 挂证书
   ```

## 5. cleanUrls 兼容性

config 里启用了 `cleanUrls: true`，产物 URL 去掉 `.html` 后缀
（`/guide/quickstart` 而非 `/guide/quickstart.html`）。

- GitHub Pages **原生支持** cleanUrls（自动匹配 `foo.html`），无需额外配置。
- 若自行用 **Nginx** 托管，需加 `try_files`：

  ```nginx
  location / {
      try_files $uri $uri.html $uri/ =404;
  }
  ```

- **Caddy** 使用 `file_server` 时对 `.html` 的 clean URL 亦原生支持，
  或显式：`try_files {path} {path}.html {path}/ =404`。

## 回滚

删除 Settings → Pages 的 Custom domain，并把 `docs-site/CNAME` 恢复为占位或删除，
站点回到 project URL。
