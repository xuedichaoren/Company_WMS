// pages/goods/index.js
// ============================================================
// 商品管理页：列表 / 搜索 / 分类筛选 / 新增 / 编辑 / 删除
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

/** 空表单，用于新增 */
function emptyForm(category) {
  return {
    id: '',
    title: '',
    spec: '',
    sku: '',
    barCode: '',
    category: category || store.getDefaultCategory(),
    unit: '件',
    location: '',
    supplier: '',
    stock: '',
    safeStock: '',
    price: ''
  }
}

Page({
  data: {
    keyword: '',
    category: '全部',
    // 筛选条：'全部' + 分类表；表单分类不含「全部」，避免商品被误存为「全部」
    categories: ['全部'],
    formCategories: [],
    goodsList: [],
    total: 0,
    // 编辑弹层
    showEditor: false,
    editorTitle: '新增商品',
    // 初始值不读存储，等用户点「新增」时再由 emptyForm() 取默认分类
    form: {
      id: '',
      title: '',
      spec: '',
      sku: '',
      barCode: '',
      category: '',
      unit: '件',
      location: '',
      supplier: '',
      stock: '',
      safeStock: '',
      price: ''
    },
    // picker 选中下标
    categoryIndex: 0
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  /** 重新加载列表（分类可能已在分类管理页被增删，每次都要重新取） */
  refresh() {
    const names = store.categoryNames()
    const categories = ['全部'].concat(names)
    // 当前筛选的分类若已被删除，回退到「全部」
    const category = categories.indexOf(this.data.category) === -1 ? '全部' : this.data.category

    const goodsList = store.listGoods({
      keyword: this.data.keyword,
      category
    })

    this.setData({
      categories,
      formCategories: names,
      category,
      goodsList,
      total: store.listGoods({}).length
    })

    // 商品可能已被删除，若弹层里的商品不存在则关闭弹层
    if (this.data.showEditor && this.data.form.id) {
      if (!store.getGoods(this.data.form.id)) {
        this.setData({ showEditor: false })
      }
    }
  },

  handleKeywordInput(e) {
    this.setData({ keyword: e.detail.value }, () => this.refresh())
  },

  handleClear() {
    this.setData({ keyword: '' }, () => this.refresh())
  },

  handleCategoryTap(e) {
    const { category } = e.currentTarget.dataset
    if (category === this.data.category) return
    this.setData({ category }, () => this.refresh())
  },

  /** 进入分类管理页，增删改分类 */
  handleManageCategory() {
    wx.navigateTo({
      url: '/pages/category/index',
      fail: () => {
        wx.showToast({ title: '打开分类管理失败', icon: 'none' })
      }
    })
  },

  /** 打开新增弹层 */
  handleCreate() {
    // 当前筛选的分类可以直接沿用；在「全部」下则用默认分类
    const category =
      this.data.category === '全部'
        ? this.data.formCategories[0] || store.FALLBACK_CATEGORY
        : this.data.category
    this.setData({
      showEditor: true,
      editorTitle: '新增商品',
      form: emptyForm(category),
      categoryIndex: Math.max(0, this.data.formCategories.indexOf(category))
    })
  },

  /** 打开编辑弹层 */
  handleEdit(e) {
    const id = e.currentTarget.dataset.id
    const goods = store.getGoods(id)
    if (!goods) return

    this.setData({
      showEditor: true,
      editorTitle: '编辑商品',
      categoryIndex: Math.max(0, this.data.formCategories.indexOf(goods.category)),
      form: {
        id: goods.id,
        title: goods.title,
        spec: goods.spec,
        sku: goods.sku,
        barCode: goods.barCode,
        category: goods.category,
        unit: goods.unit,
        location: goods.location,
        supplier: goods.supplier || '',
        stock: `${goods.stock}`,
        safeStock: `${goods.safeStock}`,
        price: `${goods.price}`
      }
    })
  },

  closeEditor() {
    this.setData({ showEditor: false })
  },

  /** 阻止点击弹层内容时关闭 */
  noop() {},

  /** 通用字段输入 */
  handleFieldInput(e) {
    const { field } = e.currentTarget.dataset
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  /** 分类选择 */
  handleCategoryChange(e) {
    const index = Number(e.detail.value)
    this.setData({
      categoryIndex: index,
      'form.category': this.data.formCategories[index]
    })
  },

  /** 保存商品 */
  handleSave() {
    const form = this.data.form

    if (!form.title.trim()) {
      wx.showToast({ title: '请填写商品名称', icon: 'none' })
      return
    }
    if (!form.sku.trim()) {
      wx.showToast({ title: '请填写商品 SKU', icon: 'none' })
      return
    }

    const payload = Object.assign({}, form, {
      stock: form.stock === '' ? 0 : Number(form.stock),
      safeStock: form.safeStock === '' ? 0 : Number(form.safeStock),
      price: form.price === '' ? 0 : Number(form.price)
    })

    const result = store.saveGoods(payload)
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData({ showEditor: false })
    this.refresh()
    wx.showToast({ title: form.id ? '已保存修改' : '商品已新增', icon: 'success' })
  },

  /** 删除商品 */
  handleDelete(e) {
    const id = e.currentTarget.dataset.id
    const goods = store.getGoods(id)
    if (!goods) return

    wx.showModal({
      title: '删除商品',
      content: `确定删除「${goods.title}」吗？删除后该商品的库存信息将一并移除。`,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        const result = store.removeGoods(id)
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        this.setData({ showEditor: false })
        this.refresh()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },

  /** 查看商品详情（点击卡片主体） */
  handleGoodsTap(e) {
    const id = e.currentTarget.dataset.id
    const goods = store.getGoods(id)
    if (!goods) return

    wx.showActionSheet({
      itemList: ['编辑商品', '删除商品'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.handleEdit({ currentTarget: { dataset: { id } } })
          return
        }
        this.handleDelete({ currentTarget: { dataset: { id } } })
      },
      fail: () => {}
    })
  }
})
