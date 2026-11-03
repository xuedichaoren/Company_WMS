// pages/outbound/index.js
// ============================================================
// 出库页：扫码 / 搜索选择商品 → 填写数量 → 校验库存 → 提交出库
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

Page({
  data: {
    keyword: '',
    suggestions: [],
    goods: null,
    quantity: '',
    location: '',
    remark: '',
    quickGoods: [],
    lastResult: null,
    submitting: false,
    // 出库后预计剩余库存
    remainStock: null
  },

  onLoad(options) {
    this.loadQuickGoods()

    if (options && options.code) {
      this.handleCode(decodeURIComponent(options.code))
    }
  },

  onShow() {
    this.loadQuickGoods()
  },

  /** 可出库商品（库存大于 0） */
  loadQuickGoods() {
    const list = store.listGoods({ status: 'all' }).filter((item) => item.stock > 0)
    this.setData({ quickGoods: list.slice(0, 6) })
  },

  /** 调起微信扫码 */
  handleScan() {
    wx.scanCode({
      onlyFromCamera: false,
      scanType: ['barCode', 'qrCode'],
      success: (res) => {
        const code = (res.result || '').trim()
        if (!code) {
          wx.showToast({ title: '未识别到条码内容', icon: 'none' })
          return
        }
        this.handleCode(code)
      },
      fail: (err) => {
        const message = (err && err.errMsg) || ''
        if (message.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败，请重试', icon: 'none' })
        }
      }
    })
  },

  /** 扫码 / 条码输入结果处理 */
  handleCode(code) {
    const goods = store.findGoodsByCode(code)
    if (goods) {
      this.selectGoods(goods)
      wx.showToast({ title: `已匹配 ${goods.title}`, icon: 'none' })
      return
    }

    // 未命中时清空已选商品，避免误提交
    this.setData({
      goods: null,
      quantity: '',
      remainStock: null,
      location: '',
      remark: '',
      keyword: code,
      suggestions: store.listGoods({ keyword: code }),
      lastResult: null
    })
    wx.showToast({ title: '未找到条码对应的商品', icon: 'none' })
  },

  handleKeywordInput(e) {
    const keyword = e.detail.value
    this.setData({
      keyword,
      suggestions: keyword.trim() ? store.listGoods({ keyword }) : []
    })
  },

  handleClear() {
    this.setData({
      keyword: '',
      suggestions: [],
      goods: null,
      quantity: '',
      location: '',
      remark: '',
      remainStock: null
    })
  },

  /** 选中商品 */
  selectGoods(goods) {
    this.setData({
      goods,
      keyword: '',
      suggestions: [],
      quantity: '',
      remainStock: null,
      location: goods.location || '',
      lastResult: null
    })
  },

  handleSuggestionTap(e) {
    const goods = store.getGoods(e.currentTarget.dataset.id)
    if (goods) this.selectGoods(goods)
  },

  handleQuickTap(e) {
    const goods = store.getGoods(e.currentTarget.dataset.id)
    if (goods) this.selectGoods(goods)
  },

  /** 数量输入：同步计算剩余库存 */
  handleQtyInput(e) {
    this.applyQuantity(e.detail.value.replace(/[^\d]/g, ''))
  },

  /** 步进器 + / - */
  handleQtyStep(e) {
    const delta = Number(e.currentTarget.dataset.step)
    const current = Number(this.data.quantity) || 0
    const next = current + delta
    this.applyQuantity(next > 0 ? `${next}` : '')
  },

  /** 快捷加量 / 全部出库 */
  handleQtyQuick(e) {
    const { value } = e.currentTarget.dataset
    const goods = this.data.goods

    if (value === 'all') {
      if (!goods) return
      this.applyQuantity(`${goods.stock}`)
      return
    }

    const current = Number(this.data.quantity) || 0
    this.applyQuantity(`${current + Number(value)}`)
  },

  /**
   * 写入数量并计算剩余库存
   * @param {string} quantity
   */
  applyQuantity(quantity) {
    const goods = this.data.goods
    const num = Number(quantity) || 0
    this.setData({
      quantity,
      remainStock: goods ? goods.stock - num : null
    })
  },

  handleLocationInput(e) {
    this.setData({ location: e.detail.value })
  },

  handleRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  /** 提交出库 */
  handleSubmit() {
    if (this.data.submitting) return

    const goods = this.data.goods
    if (!goods) {
      wx.showToast({ title: '请先扫码或选择商品', icon: 'none' })
      return
    }

    const quantity = Number(this.data.quantity)
    if (!quantity || quantity <= 0) {
      wx.showToast({ title: '请输入出库数量', icon: 'none' })
      return
    }
    if (quantity > goods.stock) {
      wx.showToast({ title: `库存不足，最多出库 ${goods.stock}${goods.unit}`, icon: 'none' })
      return
    }

    const user = store.getUser()
    this.setData({ submitting: true })

    const result = store.addRecord({
      type: 'out',
      goodsId: goods.id,
      quantity,
      location: this.data.location,
      remark: this.data.remark,
      operator: user ? user.name : '张伟'
    })

    if (!result.ok) {
      this.setData({ submitting: false })
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    const latestGoods = store.getGoods(goods.id)

    this.setData({
      submitting: false,
      quantity: '',
      remark: '',
      remainStock: null,
      goods: latestGoods,
      lastResult: {
        id: result.record.id,
        title: result.record.title,
        quantity: result.record.quantity,
        unit: result.record.unit,
        stock: latestGoods ? latestGoods.stock : 0
      }
    })

    this.loadQuickGoods()

    wx.showToast({ title: '出库成功', icon: 'success' })
    wx.vibrateShort({ type: 'light', fail: () => {} })
  },

  /** 本次出库详情 */
  handleResultTap() {
    const result = this.data.lastResult
    if (!result) return
    wx.showModal({
      title: '出库成功',
      content: `单号：${result.id}\n商品：${result.title}\n数量：${result.quantity}${result.unit}\n剩余库存：${result.stock}${result.unit}`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 切换回入库页 */
  handleSwitchType(e) {
    const { type } = e.currentTarget.dataset
    if (type === 'in') {
      wx.redirectTo({ url: '/pages/inbound/index' })
    }
  },

  handleGoLog() {
    wx.navigateTo({ url: '/pages/log/index' })
  }
})
