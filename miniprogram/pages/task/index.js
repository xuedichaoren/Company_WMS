// pages/task/index.js
// ============================================================
// 生产任务页：当前任务 / 物料齐套分析 / 采购清单 / 报工
// 核心逻辑：按 BOM 单台用量 × 计划台数，逐项比对库存
//   short 库存不足 → 需采购
//   warn  做完这一单后低于安全库存
// 数据来源：utils/store.js
// ============================================================

const store = require('../../utils/store.js')

/** 物料筛选 */
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'short', label: '缺料' },
  { key: 'warn', label: '做完预警' },
  { key: 'ok', label: '充足' }
]

/** 任务排序模式文案（与首页排序条一致） */
const SORT_LABELS = {
  due: '交付日期',
  amount: '任务总价',
  created: '下单时间',
  manual: '手动排序'
}

/** 补一版展示字段，避免 WXML 里写过长的三元表达式 */
function toViewItem(item) {
  let tagClass = 'tag--success'
  if (item.status === 'short') tagClass = 'tag--danger'
  else if (item.status === 'warn') tagClass = 'tag--warning'

  return Object.assign({}, item, {
    tagClass,
    diffText: item.status === 'short' ? `-${item.gap}` : `${item.after}`,
    diffLabel: item.status === 'short' ? '缺口' : '做完剩',
    diffDanger: item.status === 'short'
  })
}

/** 筛选标签带上数量，例如「缺料 6」 */
function buildFilters(analysis) {
  const summary = analysis
    ? analysis.summary
    : { totalKinds: 0, shortKinds: 0, warnKinds: 0, okKinds: 0 }
  const counts = {
    all: summary.totalKinds,
    short: summary.shortKinds,
    warn: summary.warnKinds,
    ok: summary.okKinds
  }
  return FILTERS.map((item) => Object.assign({}, item, { count: counts[item.key] || 0 }))
}

/** 日期文本：2026-11-08 */
function dayText(date) {
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 新建任务默认交付日期：7 天后 */
function defaultDue() {
  const now = new Date()
  return dayText(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
}

/**
 * 任务列表：按优先级排序，进行中的带序号与可移动标记
 * 已完成的排在最后、不参与手动排序
 */
function buildTaskList() {
  const all = store.listTasks()
  const doingCount = all.filter((task) => task.status === 'doing').length
  let index = 0

  return all.map((task) => {
    const isDoing = task.status === 'doing'
    const priority = isDoing ? ++index : 0
    return Object.assign({}, task, {
      priority,
      canMoveUp: isDoing && priority > 1,
      canMoveDown: isDoing && priority < doingCount
    })
  })
}

Page({
  data: {
    // 当前查看的任务
    taskId: '',
    task: null,
    taskRank: 0,
    sortLabel: '',
    analysis: null,
    summary: null,
    // 物料列表（已按筛选条件过滤）
    items: [],
    filter: 'all',
    filters: FILTERS.map((item) => Object.assign({}, item, { count: 0 })),
    // 任务列表（切换 / 删除）
    tasks: [],
    showTaskList: false,
    taskList: [],
    // 新建任务弹层
    showCreator: false,
    boms: [],
    bomNames: [],
    bomIndex: 0,
    // 从 BOM 页带过来的版本号：新建任务时默认选中它
    presetVersion: '',
    planQty: '20',
    dueDate: '',
    todayText: '',
    remark: '',
    // 新建任务时的收货信息（可先空着，建完在任务卡上再补）
    receiver: '',
    receiverCompany: '',
    receiverPhone: '',
    address: '',
    // 收货信息编辑弹层
    showReceiver: false,
    receiverForm: { receiver: '', receiverCompany: '', receiverPhone: '', address: '' },
    // 报工弹层
    showReporter: false,
    reportQty: '',
    // 采购清单弹层
    showPurchase: false,
    purchaseText: '',
    // 提示语
    tipText: '',
    tipLevel: 'ok'
  },

  onLoad(options) {
    this.setData({ todayText: dayText(new Date()), dueDate: defaultDue() })
    if (options && options.taskId) {
      this.setData({ taskId: options.taskId })
    }
    // 从 BOM 维护页「用该版本下任务」进来：预选版本，并自动打开新建弹层
    if (options && options.version) {
      let version = options.version
      try {
        version = decodeURIComponent(version)
      } catch (err) {
        // 已经是解码后的明文，直接用
      }
      this.setData({ presetVersion: version })
      this.autoCreate = true
    }
    this.refresh()
  },

  onShow() {
    // 物料库存、BOM、交付日期可能在其他页面被改动，返回时按本地缓存重读并重新分析
    store.reload()
    this.refresh()
    if (this.autoCreate) {
      this.autoCreate = false
      this.handleCreate()
    }
  },

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  /** 重新加载任务与齐套分析 */
  refresh() {
    const tasks = store.listTasks()
    const current = store.getCurrentTask()
    const sortLabel = SORT_LABELS[store.getTaskSortMode()] || '交付日期'

    let targetId = this.data.taskId
    const targetExists = targetId && tasks.some((item) => item.id === targetId)
    if (!targetExists) {
      targetId = current ? current.id : tasks.length ? tasks[0].id : ''
    }

    if (!targetId) {
      this.setData({
        taskId: '',
        task: null,
        analysis: null,
        summary: null,
        items: [],
        tasks,
        sortLabel,
        filters: buildFilters(null),
        tipText: '还没有生产任务，点下方按钮创建一个',
        tipLevel: 'muted'
      })
      return
    }

    const detail = store.getTaskAnalysis(targetId)
    if (!detail) {
      this.setData({ taskId: '', task: null, analysis: null, items: [], tasks })
      return
    }

    const { task, analysis } = detail

    let tipText = ''
    let tipLevel = 'ok'
    if (!analysis) {
      tipText = '该任务对应的 BOM 已被删除，请重新维护版本'
      tipLevel = 'danger'
    } else if (!analysis.items.length) {
      tipText = '该版本还没有物料，请先去 BOM 维护添加'
      tipLevel = 'warning'
    } else if (analysis.summary.canFinish) {
      tipText = '物料齐套，可以开工'
      tipLevel = 'ok'
    } else {
      tipText = `当前物料最多可做 ${analysis.summary.maxAssemble} 台，计划 ${analysis.planQty} 台`
      tipLevel = 'danger'
    }

    // 当前任务在队列中的优先级位置（已完成任务不参与排序）
    let taskRank = 0
    if (task.status === 'doing') {
      taskRank = tasks.filter((item) => item.status === 'doing').findIndex((item) => item.id === targetId) + 1
    }

    this.setData(
      {
        taskId: targetId,
        task,
        taskRank,
        analysis,
        summary: analysis ? analysis.summary : null,
        tasks,
        sortLabel,
        filters: buildFilters(analysis),
        tipText,
        tipLevel
      },
      () => this.applyFilter()
    )
  },

  /** 按筛选条件生成物料列表 */
  applyFilter() {
    const analysis = this.data.analysis
    if (!analysis) {
      this.setData({ items: [] })
      return
    }

    const filter = this.data.filter
    const list = filter === 'all'
      ? analysis.items
      : analysis.items.filter((item) => item.status === filter)

    this.setData({ items: list.map(toViewItem) })
  },

  handleFilterTap(e) {
    const { key } = e.currentTarget.dataset
    if (key === this.data.filter) return
    this.setData({ filter: key }, () => this.applyFilter())
  },

  /** 打开任务列表弹层（切换 / 排序 / 删除 / 新建） */
  handleSwitchTask() {
    const taskList = buildTaskList()
    if (!taskList.length) {
      this.handleCreate()
      return
    }
    this.setData({ showTaskList: true, taskList })
  },

  /**
   * 手动调整优先级：上移 / 下移
   * 结果写进任务权重，首页与这里看到的是同一个顺序
   */
  handleTaskMove(e) {
    const { id, dir } = e.currentTarget.dataset
    if (!id || !dir) return

    const result = store.moveTask(id, dir)
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData({ taskList: buildTaskList() })
    this.refresh()
    wx.showToast({ title: `已调整为第 ${result.position} 位`, icon: 'none' })
  },

  /** 恢复按交付日期自动排序（覆盖手动顺序） */
  handleResetOrder() {
    wx.showModal({
      title: '按交付日期重排',
      content: '将按交付日期从早到晚重新排列所有进行中的任务，手动调整过的顺序会被覆盖。',
      confirmText: '重排',
      success: (res) => {
        if (!res.confirm) return
        store.resetTaskOrder()
        this.setData({ taskList: buildTaskList() })
        this.refresh()
        wx.showToast({ title: '已按交付日期重排', icon: 'none' })
      }
    })
  },

  closeTaskList() {
    this.setData({ showTaskList: false })
  },

  /** 选中列表里的任务 */
  handleTaskPick(e) {
    const { id } = e.currentTarget.dataset
    if (!id) return
    if (id === this.data.taskId) {
      this.closeTaskList()
      return
    }
    this.setData({ taskId: id, filter: 'all', showTaskList: false }, () => this.refresh())
  },

  /** 从列表里新建任务 */
  handleTaskCreate() {
    this.setData({ showTaskList: false }, () => this.handleCreate())
  },

  /** 删除任务：列表里的「删除」与「⋯」菜单共用 */
  handleTaskDelete(e) {
    const id = (e && e.currentTarget && e.currentTarget.dataset.id) || this.data.taskId
    const task = store.listTasks().find((item) => item.id === id)
    if (!task) {
      wx.showToast({ title: '任务已不存在', icon: 'none' })
      return
    }

    const content = task.doneQty > 0
      ? `已报工 ${task.doneQty}/${task.planQty} 台，删除后任务本身消失，但已领用的库存与领料记录会保留、不回滚。确定删除吗？`
      : `删除「${task.version} × ${task.planQty} 台」后，该任务的齐套分析一并移除，不影响库存。确定删除吗？`

    wx.showModal({
      title: '删除任务',
      content,
      confirmText: '删除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        const deletingCurrent = task.id === this.data.taskId
        const result = store.removeTask(task.id)
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        this.setData(
          {
            taskId: deletingCurrent ? '' : this.data.taskId,
            showTaskList: false
          },
          () => this.refresh()
        )
        wx.showToast({ title: result.message, icon: 'none' })
      }
    })
  },

  /** 更多操作：结束任务 / 删除任务 / 维护 BOM */
  handleMore() {
    const task = this.data.task
    if (!task) return

    const actions = []
    if (task.status !== 'done') actions.push({ key: 'finish', label: '结束任务（提前收工）' })
    actions.push({ key: 'delete', label: '删除任务' })
    actions.push({ key: 'bom', label: '维护 BOM' })

    wx.showActionSheet({
      itemList: actions.map((item) => item.label),
      success: (res) => {
        const action = actions[res.tapIndex]
        if (!action) return
        if (action.key === 'finish') {
          this.handleFinish()
        } else if (action.key === 'delete') {
          this.handleTaskDelete({ currentTarget: { dataset: { id: task.id } } })
        } else {
          this.handleGoBom()
        }
      },
      fail: () => {}
    })
  },

  // ============================================================
  // 新建任务
  // ============================================================

  /** 打开新建任务弹层 */
  handleCreate() {
    const boms = store.listBoms()
    if (!boms.length) {
      wx.showModal({
        title: '还没有 BOM',
        content: '请先在「BOM 维护」里新增一个机型版本并添加物料。',
        confirmText: '去维护',
        success: (res) => {
          if (res.confirm) this.handleGoBom()
        }
      })
      return
    }

    // 优先用 BOM 页带过来的版本，其次是当前任务的版本
    const preset = this.data.presetVersion
    const currentVersion = this.data.task ? this.data.task.version : ''
    let index = preset ? boms.findIndex((item) => item.version === preset) : -1
    if (index === -1) index = boms.findIndex((item) => item.version === currentVersion)
    if (index === -1) index = 0

    this.setData({
      showCreator: true,
      boms,
      bomNames: boms.map((item) => `${item.version} · ${item.name}`),
      bomIndex: index,
      presetVersion: '',
      planQty: '20',
      dueDate: defaultDue(),
      remark: '',
      // 收货信息不自动带上一次的值，避免给不同客户下单时误提交旧地址
      receiver: '',
      receiverCompany: '',
      receiverPhone: '',
      address: ''
    })
  },

  /** 新建任务时沿用当前任务的收货信息（同一客户续单） */
  handleCopyReceiver() {
    const task = this.data.task
    if (!task || !task.hasReceiver) {
      wx.showToast({ title: '当前任务还没有收货信息', icon: 'none' })
      return
    }
    this.setData({
      receiver: task.receiver || '',
      receiverCompany: task.receiverCompany || '',
      receiverPhone: task.receiverPhone || '',
      address: task.address || ''
    })
  },

  /** 新建任务：选择交付日期 */
  handleDueChange(e) {
    this.setData({ dueDate: e.detail.value })
  },

  /** 修改当前任务的交付日期（点任务卡上的日期直接选） */
  handleTaskDueChange(e) {
    const task = this.data.task
    if (!task) return

    const result = store.setTaskDueDate(task.id, e.detail.value)
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }
    this.refresh()
    wx.showToast({ title: '交付日期已更新', icon: 'none' })
  },

  closeCreator() {
    this.setData({ showCreator: false })
  },

  noop() {},

  handleBomChange(e) {
    this.setData({ bomIndex: Number(e.detail.value) || 0 })
  },

  handlePlanQtyInput(e) {
    this.setData({ planQty: e.detail.value.replace(/[^\d]/g, '') })
  },

  handlePlanQtyStep(e) {
    const delta = Number(e.currentTarget.dataset.step) || 0
    const next = (Number(this.data.planQty) || 0) + delta
    this.setData({ planQty: next > 0 ? `${next}` : '' })
  },

  handlePlanQtyQuick(e) {
    const { value } = e.currentTarget.dataset
    this.setData({ planQty: `${Number(value) || 0}` })
  },

  handleRemarkInput(e) {
    this.setData({ remark: e.detail.value })
  },

  /** 新建弹层里的收货信息输入（data-field 指定字段） */
  handleFormReceiverInput(e) {
    const { field } = e.currentTarget.dataset
    if (!field) return
    this.setData({ [field]: e.detail.value })
  },

  /** 打开收货信息编辑弹层：带入当前任务已有的收货信息 */
  openReceiver() {
    const task = this.data.task
    if (!task) return
    this.setData({
      showReceiver: true,
      receiverForm: {
        receiver: task.receiver || '',
        receiverCompany: task.receiverCompany || '',
        receiverPhone: task.receiverPhone || '',
        address: task.address || ''
      }
    })
  },

  closeReceiver() {
    this.setData({ showReceiver: false })
  },

  handleReceiverInput(e) {
    const { field } = e.currentTarget.dataset
    if (!field) return
    this.setData({ [`receiverForm.${field}`]: e.detail.value })
  },

  /** 保存收货信息 */
  handleReceiverSave() {
    const task = this.data.task
    if (!task) return

    const result = store.updateTaskReceiver(task.id, this.data.receiverForm)
    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData({ showReceiver: false }, () => this.refresh())
    wx.showToast({ title: '收货信息已保存', icon: 'success' })
  },

  /** 创建任务 */
  handleCreateSubmit() {
    const bom = this.data.boms[this.data.bomIndex]
    if (!bom) {
      wx.showToast({ title: '请选择机型版本', icon: 'none' })
      return
    }

    const planQty = Number(this.data.planQty)
    if (!planQty || planQty <= 0) {
      wx.showToast({ title: '请输入计划数量', icon: 'none' })
      return
    }

    const user = store.getUser()
    const result = store.saveTask({
      bomId: bom.id,
      planQty,
      dueDate: this.data.dueDate,
      remark: this.data.remark,
      operator: user ? user.name : '张伟',
      receiver: this.data.receiver,
      receiverCompany: this.data.receiverCompany,
      receiverPhone: this.data.receiverPhone,
      address: this.data.address
    })

    if (!result.ok) {
      wx.showToast({ title: result.message, icon: 'none' })
      return
    }

    this.setData(
      { showCreator: false, taskId: result.task.id, filter: 'all' },
      () => this.refresh()
    )
    wx.showToast({ title: '任务已创建', icon: 'success' })
  },

  // ============================================================
  // 采购清单
  // ============================================================

  handlePurchaseOpen() {
    const analysis = this.data.analysis
    if (!analysis || !analysis.shorts.length) {
      wx.showToast({ title: '没有缺料，无需采购', icon: 'none' })
      return
    }

    const lines = analysis.shorts.map(
      (item, index) =>
        `${index + 1}. ${item.title}（${item.sku}） 缺 ${item.gap}${item.unit} · 约 ¥${(
          item.amount
        ).toFixed(2)}`
    )

    const text = [
      `${analysis.version} 机芯物料采购清单（计划 ${analysis.planQty} 台）`,
      ...lines,
      `合计 ${analysis.shorts.length} 种，预计金额 ¥${analysis.summary.purchaseAmount.toFixed(2)}`
    ].join('\n')

    this.setData({ showPurchase: true, purchaseText: text })
  },

  closePurchase() {
    this.setData({ showPurchase: false })
  },

  /** 复制采购清单，方便发给采购同事 */
  handlePurchaseCopy() {
    wx.setClipboardData({
      data: this.data.purchaseText,
      success: () => {
        wx.showToast({ title: '已复制，可直接发给采购', icon: 'none' })
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' })
      }
    })
  },

  // ============================================================
  // 报工
  // ============================================================

  handleReportOpen() {
    const task = this.data.task
    if (!task) return
    if (task.status === 'done') {
      wx.showToast({ title: '该任务已完成', icon: 'none' })
      return
    }
    if (!this.data.analysis || !this.data.analysis.items.length) {
      wx.showToast({ title: '该版本还没有物料', icon: 'none' })
      return
    }

    this.setData({
      showReporter: true,
      reportQty: `${task.remainQty}`
    })
  },

  closeReporter() {
    this.setData({ showReporter: false })
  },

  handleReportQtyInput(e) {
    this.setData({ reportQty: e.detail.value.replace(/[^\d]/g, '') })
  },

  handleReportQtyQuick(e) {
    const { value } = e.currentTarget.dataset
    if (value === 'all') {
      this.setData({ reportQty: `${this.data.task ? this.data.task.remainQty : 0}` })
      return
    }
    this.setData({ reportQty: `${Number(value) || 0}` })
  },

  /** 报工：按 BOM 扣料 + 生成领料出库记录 */
  handleReportSubmit() {
    const qty = Number(this.data.reportQty)
    if (!qty || qty <= 0) {
      wx.showToast({ title: '请输入完工数量', icon: 'none' })
      return
    }

    const result = store.reportTask(this.data.taskId, qty)
    if (!result.ok) {
      wx.showModal({
        title: '无法报工',
        content: result.message,
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    this.setData({ showReporter: false, filter: 'all' }, () => this.refresh())

    const lines = result.lines.slice(0, 6).map((line) => `${line.title} ${line.qty}${line.unit}`)
    if (result.lines.length > 6) lines.push(`…共 ${result.lines.length} 种物料`)

    wx.showModal({
      title: `报工成功 · ${qty} 台`,
      content: `已扣减 ${result.recordCount} 种物料，每种物料单独一条领料记录（备注「生产任务领用」）：\n${lines.join('\n')}\n\n领料单号：${result.record.id} 起\n在「操作日志 → 领料」可逐条查看`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  // ============================================================
  // 其他操作
  // ============================================================

  /** 点击物料：去补料 / 看库存 */
  handleItemTap(e) {
    const { id } = e.currentTarget.dataset
    const item = this.data.items.find((row) => row.goodsId === id)
    if (!item) return

    wx.showActionSheet({
      itemList: ['去补料入库', '查看物料库存'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({
            url: `/pages/inbound/index?code=${encodeURIComponent(item.sku)}`
          })
          return
        }
        wx.navigateTo({
          url: `/pages/stock/index?code=${encodeURIComponent(item.sku)}`
        })
      },
      fail: () => {}
    })
  },

  /** 结束任务（未报工部分不扣料） */
  handleFinish() {
    const task = this.data.task
    if (!task) return
    if (task.status === 'done') {
      wx.showToast({ title: '该任务已完成', icon: 'none' })
      return
    }

    wx.showModal({
      title: '结束任务',
      content: `「${task.version}」已完工 ${task.doneQty}/${task.planQty} 台，结束未完成部分将不再扣料，确定结束吗？`,
      confirmText: '结束任务',
      confirmColor: '#ef4444',
      success: (res) => {
        if (!res.confirm) return
        const result = store.finishTask(task.id)
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        // 结算后回到「当前任务」，避免停留在已结束的任务上
        this.setData({ taskId: '', filter: 'all' }, () => this.refresh())
        wx.showToast({ title: '任务已结束', icon: 'success' })
      }
    })
  },

  handleGoBom() {
    wx.navigateTo({ url: '/pages/bom/index' })
  },

  /** 新建任务弹层里跳到 BOM 维护：先收起弹层，回来重新打开就能选到新版本 */
  handleGoBomCreate() {
    this.setData({ showCreator: false }, () => {
      wx.navigateTo({ url: '/pages/bom/index' })
    })
  },

  handleGoStock() {
    wx.navigateTo({ url: '/pages/stock/index' })
  }
})
