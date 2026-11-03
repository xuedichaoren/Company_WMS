// pages/category/index.js
// ============================================================
// 分类管理页：新增 / 重命名 / 删除商品分类
// 分类被商品或物料引用时，删除会把它们迁到「未分类」
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

Page({
  data: {
    categories: [],
    fallbackName: store.FALLBACK_CATEGORY,
    // 弹层（新增 / 重命名共用）
    showEditor: false,
    editorId: '',
    editorTitle: '新增分类',
    name: '',
    focus: false
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  /** 重新加载分类列表 */
  refresh() {
    this.setData({ categories: store.listCategories() })
  },

  /** 打开新增弹层 */
  handleCreate() {
    this.setData({
      showEditor: true,
      editorId: '',
      editorTitle: '新增分类',
      name: '',
      focus: true
    })
  },

  /** 打开重命名弹层 */
  handleEdit(e) {
    const id = e.currentTarget.dataset.id
    const category = this.data.categories.find((item) => item.id === id)
    if (!category) return

    if (!category.removable) {
      wx.showToast({ title: '系统保留分类，不能重命名', icon: 'none' })
      return
    }

    this.setData({
      showEditor: true,
      editorId: id,
      editorTitle: '重命名分类',
      name: category.name,
      focus: true
    })
  },

  closeEditor() {
    this.setData({ showEditor: false })
  },

  /** 阻止点击弹层内容时关闭 */
  noop() {},

  handleNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  /** 保存分类（新增或重命名） */
  handleSave() {
    const name = (this.data.name || '').trim()
    if (!name) {
      wx.showToast({ title: '请填写分类名称', icon: 'none' })
      return
    }

    const isEdit = !!this.data.editorId
    const result = isEdit
      ? store.renameCategory(this.data.editorId, name)
      : store.addCategory(name)

    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData({ showEditor: false })
    this.refresh()
    wx.showToast({ title: isEdit ? '已重命名' : '已新增', icon: 'success' })
  },

  /** 点击分类条目：重命名 / 删除 */
  handleCategoryTap(e) {
    const id = e.currentTarget.dataset.id
    const category = this.data.categories.find((item) => item.id === id)
    if (!category) return

    if (!category.removable) {
      wx.showToast({ title: '系统保留分类，不能修改', icon: 'none' })
      return
    }

    wx.showActionSheet({
      itemList: ['重命名', '删除分类'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.handleEdit({ currentTarget: { dataset: { id } } })
          return
        }
        this.handleDelete({ currentTarget: { dataset: { id } } })
      },
      fail: () => {}
    })
  },

  /** 删除分类 */
  handleDelete(e) {
    const id = e.currentTarget.dataset.id
    const category = this.data.categories.find((item) => item.id === id)
    if (!category) return

    if (!category.removable) {
      wx.showToast({ title: '系统保留分类，不能删除', icon: 'none' })
      return
    }

    const content = category.goodsCount
      ? `「${category.name}」下有 ${category.goodsCount} 个商品，删除后这些商品会归到「${store.FALLBACK_CATEGORY}」，确定继续吗？`
      : `确定删除分类「${category.name}」吗？`

    wx.showModal({
      title: '删除分类',
      content,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        const result = store.removeCategory(id)
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        this.refresh()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  /** 返回商品管理 */
  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack()
      return
    }
    wx.redirectTo({ url: '/pages/goods/index' })
  }
})
