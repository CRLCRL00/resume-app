Component({
  data: {
    visible: true,
  },
  methods: {
    show() {
      this.setData({ visible: true });
    },
    hide() {
      this.setData({ visible: false });
    },
    onTapPrivacy() {
      wx.navigateTo({ url: '/pages/legal/privacy' });
    },
    onTapTerms() {
      wx.navigateTo({ url: '/pages/legal/terms' });
    },
    onAccept() {
      wx.setStorageSync('privacy_accepted', true);
      wx.setStorageSync('privacy_accepted_at', Date.now());
      this.setData({ visible: false });
      this.triggerEvent('accepted');
    },
    onReject() {
      wx.showModal({
        title: '需同意协议',
        content: '不同意将无法使用本小程序。',
        showCancel: false,
        confirmText: '我知道了',
      });
    },
  },
});