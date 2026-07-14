const { apiBaseUrl } = require('../../src/config');
const app = getApp();

Page({
  data: { title: '', content: '', updated_at: '', loading: true, error: false },
  onLoad() { this.fetch(); },
  fetch() {
    this.setData({ loading: true, error: false });
    wx.request({
      url: `${apiBaseUrl}/api/legal/privacy`,
      success: (res) => {
        if (res.data && res.data.code === 0) {
          this.setData({
            title: res.data.data.title,
            content: res.data.data.content,
            updated_at: res.data.data.updated_at,
            loading: false,
          });
        } else {
          this.setData({ loading: false, error: true });
        }
      },
      fail: () => {
        this.setData({ loading: false, error: true });
      },
    });
  },
  retry() { this.fetch(); },
  onAccept() {
    wx.setStorageSync('privacy_accepted', true);
    wx.setStorageSync('privacy_accepted_at', Date.now());
    wx.navigateBack();
  },
});