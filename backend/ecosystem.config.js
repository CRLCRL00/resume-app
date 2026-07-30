module.exports = {
  apps: [{
    name: 'resume-app-backend',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
    time: true,
  }],
};
