// pages/bom/index.js
// ============================================================
// BOM 维护页：按机型版本维护物料清单
// 支持：版本切换 / 新增版本 / 添加物料 / 修改单台用量 / 删除物料 / 粘贴导入
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

/** 物料候选最多展示条数 */
const CANDIDATE_LIMIT = 20

Page({
  data: {
    boms: [],
    activeId: '',
    bom: null,
    // 版本弹层
    showBomEditor: false,
    bomEditorTitle: '新增版本',
    bomForm: { id: '', version: '', name: '', remark: '' },
    // 物料弹层
    showItemEditor: false,
    itemGoods: null,
    itemQty: '1',
    keyword: '',
    candidates: [],
    // 导入弹层
    showImporter: false,
    importText: ''
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    // 商品库存可能变化，重新取一次
    this.refresh()
  },

  /** 重新加载版本与当前版本物料 */
  refresh() {
    const boms = store.listBoms()
    if (!boms.length) {
      this.setData({ boms: [], activeId: '', bom: null })
      return
    }

    let activeId = this.data.activeId
    if (!activeId || !boms.some((item) => item.id === activeId)) {
      activeId = boms[0].id
    }

    this.setData({
      boms,
      activeId,
      bom: store.getBom(activeId)
    })
  },

  handleVersionTap(e) {
    const { id } = e.currentTarget.dataset
    if (id === this.data.activeId) return
    this.setData({ activeId: id }, () => this.refresh())
  },

  // ============================================================
  // 版本信息
  // ============================================================

  handleAddVersion() {
    this.setData({
      showBomEditor: true,
      bomEditorTitle: '新增版本',
      bomForm: { id: '', version: '', name: '', remark: '' }
    })
  },

  handleEditVersion() {
    const bom = this.data.bom
    if (!bom) return
    this.setData({
      showBomEditor: true,
      bomEditorTitle: '编辑版本',
      bomForm: {
        id: bom.id,
        version: bom.version,
        name: bom.name,
        remark: bom.remark
      }
    })
  },

  closeBomEditor() {
    this.setData({ showBomEditor: false })
  },

  noop() {},

  handleBomFieldInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`bomForm.${field}`]: e.detail.value })
  },

  handleBomSave() {
    const form = this.data.bomForm
    if (!form.version.trim()) {
      wx.showToast({ title: '请填写版本号，如 V3.1', icon: 'none' })
      return
    }

    const result = store.saveBom({
      id: form.id,
      version: form.version,
      name: form.name,
      remark: form.remark
    })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData({ showBomEditor: false, activeId: result.bom.id }, () => this.refresh())
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  /** 删除当前版本 */
  handleBomDelete() {
    const bom = this.data.bom
    if (!bom) return

    wx.showModal({
      title: '删除版本',
      content: `确定删除「${bom.version}」及其 ${bom.itemCount} 项物料吗？该操作不可恢复。`,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        const result = store.removeBom(bom.id)
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        this.setData({ showBomEditor: false, activeId: '' }, () => this.refresh())
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  // ============================================================
  // 物料行
  // ============================================================

  /** 添加物料：打开搜索选择 */
  handleAddItem() {
    if (!this.data.bom) {
      wx.showToast({ title: '请先选择版本', icon: 'none' })
      return
    }
    this.setData({
      showItemEditor: true,
      itemGoods: null,
      itemQty: '1',
      keyword: '',
      candidates: store.listGoods({}).slice(0, CANDIDATE_LIMIT)
    })
  },

  /** 点击物料行：改用量 / 删除 */
  handleItemTap(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.bom.items.find((row) => row.goodsId === id)
    if (!item) return

    wx.showActionSheet({
      itemList: ['修改单台用量', '从 BOM 移除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.setData({
            showItemEditor: true,
            itemGoods: {
              id: item.goodsId,
              title: item.title,
              sku: item.sku,
              spec: item.spec,
              unit: item.unit,
              stock: item.stock
            },
            itemQty: `${item.qty}`,
            keyword: '',
            candidates: []
          })
          return
        }
        this.handleItemDelete(id)
      },
      fail: () => {}
    })
  },

  handleItemDelete(goodsId) {
    const item = this.data.bom && this.data.bom.items.find((row) => row.goodsId === goodsId)
    if (!item) return

    wx.showModal({
      title: '移除物料',
      content: `确定把「${item.title}」从 ${this.data.bom.version} 的 BOM 中移除吗？`,
      confirmText: '移除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        const result = store.removeBomItem(this.data.bom.id, goodsId)
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        this.refresh()
        wx.showToast({ title: '已移除', icon: 'success' })
      }
    })
  },

  closeItemEditor() {
    this.setData({ showItemEditor: false })
  },

  handleKeywordInput(e) {
    const keyword = e.detail.value
    this.setData({
      keyword,
      candidates: store.listGoods({ keyword: keyword.trim() }).slice(0, CANDIDATE_LIMIT)
    })
  },

  handleCandidateTap(e) {
    const { id } = e.currentTarget.dataset
    const goods = store.getGoods(id)
    if (!goods) return
    this.setData({ itemGoods: goods, keyword: '', candidates: [], itemQty: '1' })
  },

  handleReselectGoods() {
    this.setData({
      itemGoods: null,
      keyword: '',
      candidates: store.listGoods({}).slice(0, CANDIDATE_LIMIT)
    })
  },

  handleItemQtyInput(e) {
    this.setData({ itemQty: e.detail.value.replace(/[^\d]/g, '') })
  },

  handleItemQtyStep(e) {
    const delta = Number(e.currentTarget.dataset.step) || 0
    const next = (Number(this.data.itemQty) || 0) + delta
    this.setData({ itemQty: next > 0 ? `${next}` : '' })
  },

  handleItemSave() {
    const goods = this.data.itemGoods
    if (!goods) {
      wx.showToast({ title: '请先选择物料', icon: 'none' })
      return
    }

    const qty = Number(this.data.itemQty)
    if (!qty || qty <= 0) {
      wx.showToast({ title: '请输入单台用量', icon: 'none' })
      return
    }

    const result = store.saveBomItem({
      bomId: this.data.bom.id,
      goodsId: goods.id,
      qty
    })
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData({ showItemEditor: false })
    this.refresh()
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  // ============================================================
  // 粘贴导入
  // ============================================================

  handleImportOpen() {
    if (!this.data.bom) {
      wx.showToast({ title: '请先选择版本', icon: 'none' })
      return
    }
    this.setData({ showImporter: true, importText: '' })
  },

  closeImporter() {
    this.setData({ showImporter: false })
  },

  handleImportInput(e) {
    this.setData({ importText: e.detail.value })
  },

  handleImportSubmit() {
    const text = this.data.importText.trim()
    if (!text) {
      wx.showToast({ title: '请粘贴 BOM 内容', icon: 'none' })
      return
    }

    const result = store.importBomText(this.data.bom.id, text)
    if (!result.ok) {
      wx.showModal({
        title: '导入失败',
        content: result.message,
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    this.setData({ showImporter: false })
    this.refresh()

    let content = result.message
    if (result.unmatched.length) {
      content += `\n未匹配：${result.unmatched.slice(0, 8).join('、')}`
    }
    wx.showModal({
      title: '导入完成',
      content,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 用当前版本去下生产任务：带上版本号，任务页直接打开新建弹层并选中该版本 */
  handleGoTask() {
    const bom = this.data.bom
    if (!bom) {
      wx.navigateTo({ url: '/pages/task/index' })
      return
    }
    wx.navigateTo({
      url: `/pages/task/index?version=${encodeURIComponent(bom.version)}`
    })
  }
})
