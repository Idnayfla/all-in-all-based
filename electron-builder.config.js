module.exports = {
  appId: 'dev.getbased.app',
  productName: 'Based',
  directories: {
    output: 'dist-electron',
  },
  files: [
    'electron/**/*',
    'public/icon-512.png',
    'public/icon-512-maskable.png',
    'public/icon-192.png',
  ],
  win: {
    target: 'nsis',
    icon: 'public/icon-512.png',
  },
  mac: {
    target: 'dmg',
    icon: 'public/icon-512.png',
    category: 'public.app-category.developer-tools',
  },
  linux: {
    target: 'AppImage',
    icon: 'public/icon-512.png',
    category: 'Development',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    include: 'electron/installer.nsh',
  },
};
