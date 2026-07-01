# Deploy

## One-shot via GH Actions
1. Push to develop
2. GitHub Actions → Deploy → Run workflow → input ref
3. Backend is rebuilt + reloaded

## Manual
```bash
# Local
tar --exclude='node_modules' --exclude='.env' -czf /tmp/release.tar.gz backend/
scp /tmp/release.tar.gz ubuntu@SERVER:/tmp/

# Server
bash /opt/resume-app/backend/scripts/deploy.sh /tmp/release.tar.gz
```

## Rollback
Backups kept in `.deploy-backup/<ts>/`. To roll back:
```bash
cd /opt/resume-app/backend
cp -p .deploy-backup/<previous-ts>/package.json .
cp -pR .deploy-backup/<previous-ts>/src .
pm2 reload resume-app-backend
```
