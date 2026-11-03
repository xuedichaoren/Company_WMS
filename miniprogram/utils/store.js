// utils/store.js
// ============================================================
// WMS 演示数据仓库（纯前端，不请求后端接口）
// 职责：
//   1. 统一维护 商品 / 出入库记录 / 登录用户 三份数据
//   2. 通过 wx.setStorageSync 做本地持久化，各页面共享同一份数据
//   3. 对外暴露读写方法，接入真实接口时只需替换本文件内部实现
// ============================================================

const STORAGE_KEY = 'wms_demo_state_v1'
const SESSION_KEY = 'wms_demo_session_v1'

/** 商品分类 */
const CATEGORIES = ['数码配件', '音频设备', '智能穿戴', '办公耗材']

/** 库存状态：normal 正常 / warning 预警 / empty 缺货 */
const STOCK_STATUS_TEXT = {
  normal: '正常',
  warning: '库存预警',
  empty: '缺货'
}

// ============================================================
// 工具函数
// ============================================================

function pad(num) {
  return num < 10 ? `0${num}` : `${num}`
}

/** 日期键：2026-11-03 */
function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 小时分钟：09:15 */
function hourMinute(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 生成记录时间展示文案
 * 今天 → 09:15；昨天 → 昨天 09:15；更早 → 10-27 09:15
 */
function formatRecordTime(createdAt) {
  const date = new Date(createdAt)
  const now = new Date()
  const key = dayKey(date)
  const hm = hourMinute(date)
  if (key === dayKey(now)) return hm
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (key === dayKey(yesterday)) return `昨天 ${hm}`
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`
}

/** 记录日期分组标题：今天 / 昨天 / 2026-10-27 */
function formatDayLabel(createdAt) {
  const date = new Date(createdAt)
  const now = new Date()
  if (dayKey(date) === dayKey(now)) return '今天'
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  if (dayKey(date) === dayKey(yesterday)) return '昨天'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 深拷贝，避免页面直接改动仓库内对象 */
function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

// ============================================================
// 初始模拟数据
// ============================================================

/** 商品主数据（stock 为当前库存，safeStock 为安全库存下限） */
const SEED_GOODS = [
  {
    id: 'G1001',
    sku: 'SKU-10086',
    title: '无线蓝牙耳机',
    spec: '白色 / 标准版',
    barCode: '6901234567890',
    category: '音频设备',
    unit: '件',
    location: 'A-01-03',
    stock: 320,
    safeStock: 60,
    price: 129
  },
  {
    id: 'G1002',
    sku: 'SKU-10021',
    title: '机械键盘 K8',
    spec: '87 键 / 黑色',
    barCode: '6901234567891',
    category: '数码配件',
    unit: '件',
    location: 'B-02-01',
    stock: 45,
    safeStock: 50,
    price: 349
  },
  {
    id: 'G1003',
    sku: 'SKU-10056',
    title: '智能手环 5',
    spec: '深空灰',
    barCode: '6901234567892',
    category: '智能穿戴',
    unit: '件',
    location: 'A-02-01',
    stock: 260,
    safeStock: 40,
    price: 199
  },
  {
    id: 'G1004',
    sku: 'SKU-10008',
    title: '快充数据线',
    spec: 'Type-C / 1.5m',
    barCode: '6901234567893',
    category: '数码配件',
    unit: '件',
    location: 'C-01-02',
    stock: 680,
    safeStock: 100,
    price: 29
  },
  {
    id: 'G1005',
    sku: 'SKU-10033',
    title: '无线鼠标 M3',
    spec: '2.4G / 黑色',
    barCode: '6901234567894',
    category: '数码配件',
    unit: '件',
    location: 'B-01-02',
    stock: 12,
    safeStock: 30,
    price: 79
  },
  {
    id: 'G1006',
    sku: 'SKU-10077',
    title: '移动电源 20000mAh',
    spec: '白色 / 快充版',
    barCode: '6901234567895',
    category: '数码配件',
    unit: '件',
    location: 'C-02-03',
    stock: 0,
    safeStock: 20,
    price: 159
  },
  {
    id: 'G1007',
    sku: 'SKU-10091',
    title: 'A4 复印纸',
    spec: '70g / 500 张',
    barCode: '6901234567896',
    category: '办公耗材',
    unit: '包',
    location: 'D-01-01',
    stock: 420,
    safeStock: 80,
    price: 25
  },
  {
    id: 'G1008',
    sku: 'SKU-10102',
    title: '蓝牙音箱 mini',
    spec: '雾霾蓝',
    barCode: '6901234567897',
    category: '音频设备',
    unit: '件',
    location: 'A-03-02',
    stock: 88,
    safeStock: 30,
    price: 169
  },
  {
    id: 'G1009',
    sku: 'SKU-10118',
    title: '智能手表 S2',
    spec: '46mm / 硅胶表带',
    barCode: '6901234567898',
    category: '智能穿戴',
    unit: '件',
    location: 'A-02-04',
    stock: 36,
    safeStock: 40,
    price: 899
  },
  {
    id: 'G1010',
    sku: 'SKU-10130',
    title: '标签打印机',
    spec: '便携式 / USB',
    barCode: '6901234567899',
    category: '办公耗材',
    unit: '台',
    location: 'D-02-02',
    stock: 15,
    safeStock: 10,
    price: 299
  }
]

/**
 * 生成初始出入库记录
 * 说明：记录只作为历史展示，不再反向影响商品的初始库存
 */
function buildSeedRecords() {
  const now = Date.now()
  const hour = 60 * 60 * 1000
  const items = [
    { type: 'in', goodsId: 'G1001', quantity: 100, operator: '张伟', ago: 1.5, remark: '供应商送货入仓' },
    { type: 'out', goodsId: 'G1002', quantity: 20, operator: '李娜', ago: 2.2, remark: '电商订单出库' },
    { type: 'in', goodsId: 'G1003', quantity: 60, operator: '张伟', ago: 3.1, remark: '常规补货' },
    { type: 'out', goodsId: 'G1004', quantity: 150, operator: '王强', ago: 4.5, remark: '批发出库' },
    { type: 'in', goodsId: 'G1005', quantity: 80, operator: '李娜', ago: 26, remark: '新品上架' }
  ]

  return items.map((item, index) => {
    const goods = SEED_GOODS.find((g) => g.id === item.goodsId)
    const createdAt = now - item.ago * hour
    return {
      id: makeRecordId(item.type, createdAt, index + 1),
      type: item.type,
      typeText: item.type === 'in' ? '入库' : '出库',
      goodsId: goods.id,
      title: goods.title,
      sku: goods.sku,
      spec: goods.spec,
      quantity: item.quantity,
      unit: goods.unit,
      operator: item.operator,
      location: goods.location,
      remark: item.remark,
      createdAt,
      time: formatRecordTime(createdAt)
    }
  })
}

/** 记录单号：IN-20261103-001 */
function makeRecordId(type, createdAt, seq) {
  const date = new Date(createdAt)
  const prefix = type === 'in' ? 'IN' : 'OUT'
  let seqText = `${seq}`
  while (seqText.length < 3) seqText = `0${seqText}`
  return `${prefix}-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${seqText}`
}

// ============================================================
// 状态读写
// ============================================================

let state = null

function createInitialState() {
  return {
    goods: clone(SEED_GOODS),
    records: buildSeedRecords(),
    goodsSeq: 1000 + SEED_GOODS.length
  }
}

function loadState() {
  if (state) return state
  let stored = null
  try {
    stored = wx.getStorageSync(STORAGE_KEY)
  } catch (err) {
    stored = null
  }
  if (stored && stored.goods && stored.records) {
    state = stored
  } else {
    state = createInitialState()
    persist()
  }
  return state
}

function persist() {
  try {
    wx.setStorageSync(STORAGE_KEY, state)
  } catch (err) {
    console.warn('[WMS] 本地数据写入失败', err)
  }
}

// ============================================================
// 商品相关
// ============================================================

/** 计算库存状态 */
function stockStatusOf(goods) {
  if (!goods) return 'normal'
  if (goods.stock <= 0) return 'empty'
  if (goods.stock <= goods.safeStock) return 'warning'
  return 'normal'
}

/** 给商品补上页面需要的展示字段 */
function decorateGoods(goods) {
  const status = stockStatusOf(goods)
  return Object.assign({}, goods, {
    status,
    statusText: STOCK_STATUS_TEXT[status]
  })
}

/**
 * 查询商品列表
 * @param {object} options
 * @param {string} [options.keyword] 名称 / SKU / 条码 模糊匹配
 * @param {string} [options.category] 分类，'全部' 或空表示不限
 * @param {string} [options.status] normal / warning / empty / all
 */
function listGoods(options) {
  const opts = options || {}
  const keyword = (opts.keyword || '').trim().toLowerCase()
  const category = opts.category || '全部'
  const status = opts.status || 'all'

  const result = loadState()
    .goods.map(decorateGoods)
    .filter((goods) => {
      if (category !== '全部' && goods.category !== category) return false
      if (status !== 'all' && goods.status !== status) return false
      if (!keyword) return true
      return (
        goods.title.toLowerCase().indexOf(keyword) !== -1 ||
        goods.sku.toLowerCase().indexOf(keyword) !== -1 ||
        (goods.barCode || '').toLowerCase().indexOf(keyword) !== -1
      )
    })

  // 预警、缺货排前面，方便仓管员优先处理
  const order = { empty: 0, warning: 1, normal: 2 }
  result.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
    return a.title.localeCompare(b.title, 'zh')
  })

  return result
}

/** 按 id 查询单个商品 */
function getGoods(id) {
  const goods = loadState().goods.find((item) => item.id === id)
  return goods ? decorateGoods(goods) : null
}

/**
 * 按条码查询商品
 * 支持条码、SKU、商品编号三种扫码内容
 */
function findGoodsByCode(code) {
  const target = (code || '').trim().toLowerCase()
  if (!target) return null
  const goods = loadState().goods.find(
    (item) =>
      (item.barCode || '').toLowerCase() === target ||
      item.sku.toLowerCase() === target ||
      item.id.toLowerCase() === target
  )
  return goods ? decorateGoods(goods) : null
}

/**
 * 新增 / 更新商品
 * @param {object} payload 含 id 表示更新，不含表示新增
 * @returns {{ok: boolean, message?: string, goods?: object}}
 */
function saveGoods(payload) {
  const data = Object.assign({}, payload)
  data.title = (data.title || '').trim()
  data.sku = (data.sku || '').trim()
  data.barCode = (data.barCode || '').trim()
  data.spec = (data.spec || '').trim()
  data.category = data.category || CATEGORIES[0]
  data.unit = (data.unit || '件').trim() || '件'
  data.location = (data.location || '').trim()
  data.stock = Number(data.stock) || 0
  data.safeStock = Number(data.safeStock) || 0
  data.price = Number(data.price) || 0

  if (!data.title) return { ok: false, message: '请填写商品名称' }
  if (!data.sku) return { ok: false, message: '请填写商品 SKU' }
  if (data.stock < 0) return { ok: false, message: '库存不能小于 0' }
  if (data.safeStock < 0) return { ok: false, message: '安全库存不能小于 0' }

  const current = loadState()
  const duplicated = current.goods.find(
    (item) => item.sku.toLowerCase() === data.sku.toLowerCase() && item.id !== data.id
  )
  if (duplicated) return { ok: false, message: 'SKU 已存在，请更换' }

  if (data.id) {
    const index = current.goods.findIndex((item) => item.id === data.id)
    if (index === -1) return { ok: false, message: '商品不存在' }
    current.goods[index] = Object.assign({}, current.goods[index], data)
    persist()
    return { ok: true, goods: decorateGoods(current.goods[index]) }
  }

  current.goodsSeq += 1
  const created = Object.assign({}, data, { id: `G${current.goodsSeq}` })
  current.goods.push(created)
  persist()
  return { ok: true, goods: decorateGoods(created) }
}

/** 删除商品，返回是否成功 */
function removeGoods(id) {
  const current = loadState()
  const index = current.goods.findIndex((item) => item.id === id)
  if (index === -1) return { ok: false, message: '商品不存在' }
  current.goods.splice(index, 1)
  persist()
  return { ok: true }
}

// ============================================================
// 出入库记录
// ============================================================

/**
 * 查询记录
 * @param {object} options
 * @param {string} [options.type] in / out / all
 * @param {number} [options.limit] 限制条数
 */
function listRecords(options) {
  const opts = options || {}
  const type = opts.type || 'all'
  let result = loadState()
    .records.slice()
    .sort((a, b) => b.createdAt - a.createdAt)

  if (type !== 'all') {
    result = result.filter((item) => item.type === type)
  }

  if (opts.limit) {
    result = result.slice(0, opts.limit)
  }

  return clone(result)
}

/**
 * 新增一条出入库记录并同步商品库存
 * @param {object} payload
 * @param {'in'|'out'} payload.type 类型
 * @param {string} payload.goodsId 商品 id
 * @param {number} payload.quantity 数量（正整数）
 * @param {string} [payload.location] 库位，缺省用商品库位
 * @param {string} [payload.remark] 备注
 * @param {string} [payload.operator] 操作人
 * @returns {{ok: boolean, message?: string, record?: object}}
 */
function addRecord(payload) {
  const current = loadState()
  const type = payload.type === 'out' ? 'out' : 'in'
  const quantity = Number(payload.quantity)
  const goods = current.goods.find((item) => item.id === payload.goodsId)

  if (!goods) return { ok: false, message: '请先选择商品' }
  if (!quantity || quantity <= 0 || !Number.isInteger(quantity)) {
    return { ok: false, message: '数量需为大于 0 的整数' }
  }
  if (type === 'out' && quantity > goods.stock) {
    return { ok: false, message: `库存不足，当前仅剩 ${goods.stock}${goods.unit}` }
  }

  const createdAt = Date.now()
  const todayCount = current.records.filter(
    (item) => item.type === type && dayKey(new Date(item.createdAt)) === dayKey(new Date(createdAt))
  ).length

  const record = {
    id: makeRecordId(type, createdAt, todayCount + 1),
    type,
    typeText: type === 'in' ? '入库' : '出库',
    goodsId: goods.id,
    title: goods.title,
    sku: goods.sku,
    spec: goods.spec,
    quantity,
    unit: goods.unit,
    operator: payload.operator || '张伟',
    location: (payload.location || goods.location || '').trim(),
    remark: (payload.remark || '').trim(),
    createdAt,
    time: formatRecordTime(createdAt)
  }

  // 同步库存：入库加、出库减
  goods.stock = type === 'in' ? goods.stock + quantity : goods.stock - quantity

  current.records.unshift(record)
  persist()

  return { ok: true, record: Object.assign({}, record) }
}

// ============================================================
// 首页概览
// ============================================================

/** 首页顶部概览数据 */
function getOverview() {
  const current = loadState()
  const today = dayKey(new Date())
  let inboundCount = 0
  let outboundCount = 0

  current.records.forEach((record) => {
    if (dayKey(new Date(record.createdAt)) !== today) return
    if (record.type === 'in') inboundCount += 1
    else outboundCount += 1
  })

  const totalStock = current.goods.reduce((sum, goods) => sum + goods.stock, 0)
  const warningCount = current.goods.filter((goods) => stockStatusOf(goods) !== 'normal').length

  return {
    stats: [
      { key: 'inbound', label: '今日入库', value: inboundCount, unit: '单' },
      { key: 'outbound', label: '今日出库', value: outboundCount, unit: '单' },
      { key: 'stock', label: '在库商品', value: totalStock, unit: '件' },
      { key: 'warning', label: '库存预警', value: warningCount, unit: '项' }
    ]
  }
}

// ============================================================
// 登录态
// ============================================================

/** 读取当前登录用户，未登录返回 null */
function getUser() {
  try {
    return wx.getStorageSync(SESSION_KEY) || null
  } catch (err) {
    return null
  }
}

/** 保存登录用户 */
function setUser(user) {
  try {
    wx.setStorageSync(SESSION_KEY, user)
  } catch (err) {
    console.warn('[WMS] 登录态写入失败', err)
  }
}

/** 清除登录态 */
function clearUser() {
  try {
    wx.removeStorageSync(SESSION_KEY)
  } catch (err) {
    console.warn('[WMS] 登录态清除失败', err)
  }
}

/** 恢复演示数据：清空商品 / 记录，重新写入初始数据 */
function resetDemoData() {
  state = createInitialState()
  persist()
  return true
}

module.exports = {
  CATEGORIES,
  STOCK_STATUS_TEXT,
  listGoods,
  getGoods,
  findGoodsByCode,
  saveGoods,
  removeGoods,
  listRecords,
  addRecord,
  getOverview,
  getUser,
  setUser,
  clearUser,
  resetDemoData,
  formatRecordTime,
  formatDayLabel
}
