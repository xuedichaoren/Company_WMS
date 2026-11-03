// pages/inbound/index.js
// ============================================================
// 入库页：扫码 / 搜索选择商品 → 填写数量库位 → 提交入库
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

Page({
  data: {
    // 搜索关键词（商品名 / SKU / 条码）
    keyword: '',
    // 搜索结果（未选中商品时展示）
    suggestions: [],
    // 已选商品
    goods: null,
    // 录入表单
    quantity: '',
    location: '',
    remark: '',
    // 常用商品快捷入口
    quickGoods: [],
    // 最近一次入库结果
    lastResult: null,
    // 提交中标记，避免重复点击
    submitting: false
  },

  onLoad(options) {
    this.loadQuickGoods()

    // 从首页扫码进入时，链接上会带 code 参数
    if (options && options.code) {
      this.handleCode(decodeURIComponent(options.code))
    }
  },

  onShow() {
    // 商品库存可能已被其他页面修改，刷新常用商品数据
    this.loadQuickGoods()
  },

  /** 加载常用商品（库存少的优先，方便补货） */
  loadQuickGoods() {
    this.setData({
      quickGoods: store.listGoods({ status: 'all' }).slice(0, 6)
    })
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

  /**
   * 处理扫码 / 手输条码结果
   * 命中商品直接选中，未命中则转为关键词搜索
   */
  handleCode(code) {
    const goods = store.findGoodsByCode(code)
    if (goods) {
      this.selectGoods(goods)
      wx.showToast({ title: `已匹配 ${goods.title}`, icon: 'none' })
      return
    }

    // 未命中时清空已选商品，避免误把上一件商品入库
    this.setData({
      goods: null,
      quantity: '',
      location: '',
      remark: '',
      keyword: code,
      suggestions: store.listGoods({ keyword: code }),
      lastResult: null
    })
    wx.showToast({ title: '未找到条码对应的商品', icon: 'none' })
  },

  /** 搜索关键词输入 */
  handleKeywordInput(e) {
    const keyword = e.detail.value
    this.setData({
      keyword,
      suggestions: keyword.trim() ? store.listGoods({ keyword }) : []
    })
  },

  /** 清空搜索与已选商品 */
  handleClear() {
    this.setData({
      keyword: '',
      suggestions: [],
      goods: null,
      quantity: '',
      location: '',
      remark: ''
    })
  },

  /** 选中商品 */
  selectGoods(goods) {
    this.setData({
      goods,
      keyword: '',
      suggestions: [],
      quantity: '',
      location: goods.location || '',
      lastResult: null
    })
  },

  /** 从搜索结果中点选 */
  handleSuggestionTap(e) {
    const { id } = e.currentTarget.dataset
    const goods = store.getGoods(id)
    if (goods) this.selectGoods(goods)
  },

  /** 从常用商品中点选 */
  handleQuickTap(e) {
    const { id } = e.currentTarget.dataset
    const goods = store.getGoods(id)
    if (goods) this.selectGoods(goods)
  },

  /** 数量输入 */
  handleQtyInput(e) {
    const value = e.detail.value.replace(/[^\d]/g, '')
    this.setData({ quantity: value })
  },

  /** 数量增加 / 减少 */
  handleQtyStep(e) {
    const { step } = e.currentTarget.dataset
    const delta = Number(step)
    const current = Number(this.data.quantity) || 0
    const next = current + delta
    this.setData({ quantity: next > 0 ? `${next}` : '' })
  },

  /** 快捷加量：+10 / +50 / +100 */
  handleQtyQuick(e) {
    const { value } = e.currentTarget.dataset
    const current = Number(this.data.quantity) || 0
    this.setData({ quantity: `${current + Number(value)}` })
  },

  handleLocationInput(e) {
    this.setData({ location: e.detail.value })
  },

  handleRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  /** 提交入库 */
  handleSubmit() {
    if (this.data.submitting) return

    const goods = this.data.goods
    if (!goods) {
      wx.showToast({ title: '请先扫码或选择商品', icon: 'none' })
      return
    }

    const quantity = Number(this.data.quantity)
    if (!quantity || quantity <= 0) {
      wx.showToast({ title: '请输入入库数量', icon: 'none' })
      return
    }

    const user = store.getUser()
    this.setData({ submitting: true })

    const result = store.addRecord({
      type: 'in',
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

    wx.showToast({ title: '入库成功', icon: 'success' })
    wx.vibrateShort({ type: 'light', fail: () => {} })
  },

  /** 查看本次入库记录详情 */
  handleResultTap() {
    const result = this.data.lastResult
    if (!result) return
    wx.showModal({
      title: '入库成功',
      content: `单号：${result.id}\n商品：${result.title}\n数量：${result.quantity}${result.unit}\n当前库存：${result.stock}${result.unit}`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 切换到出库页 */
  handleSwitchType(e) {
    const { type } = e.currentTarget.dataset
    if (type === 'out') {
      wx.redirectTo({ url: '/pages/outbound/index' })
    }
  },

  /** 去操作日志 */
  handleGoLog() {
    wx.navigateTo({ url: '/pages/log/index' })
  }
})
