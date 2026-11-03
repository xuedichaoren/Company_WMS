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

/** 数据结构版本，用于存量数据迁移 */
const SCHEMA_VERSION = 8

/**
 * 任务排序模式
 * - due：按交付日期（默认，早的优先）
 * - amount：按任务总价（高的优先）
 * - created：按创建时间（先下的先做）
 * - manual：手动优先级（拖动 / 编号 / 上下移）
 */
const TASK_SORT_MODES = [
  { key: 'due', label: '交付日期' },
  { key: 'amount', label: '任务总价' },
  { key: 'created', label: '下单日期' },
  { key: 'manual', label: '手动排序' }
]
const DEFAULT_SORT_MODE = 'due'

/** 兜底分类：删除某个分类时，其下商品默认归到这里；本分类不可删除 */
const FALLBACK_CATEGORY = '未分类'

/**
 * 商品 / 物料分类种子数据
 * 前 4 个为机芯生产物料，中间 4 个保留原有演示商品分类，最后一个是兜底分类
 * 运行期以 state.categories 为准，用户可在「分类管理」页增删改
 */
const SEED_CATEGORIES = [
  '机芯结构件',
  '电机驱动',
  '电子元件',
  '线束辅料',
  '数码配件',
  '音频设备',
  '智能穿戴',
  '办公耗材',
  FALLBACK_CATEGORY
].map((name, index) => ({ id: `C${`00${index + 1}`.slice(-3)}`, name }))

/** 库存状态：normal 正常 / warning 预警 / empty 缺货 */
const STOCK_STATUS_TEXT = {
  normal: '正常',
  warning: '库存预警',
  empty: '缺货'
}

/**
 * 出入库记录上限
 * 生产报工会按物料逐条写入，记录增长很快；小程序单个 key 上限 1MB，
 * 超限后 setStorageSync 会静默失败（表现为「提示成功但重启后数据丢了」），
 * 这里保留最近 2000 条，超出部分从最早的开始丢弃。
 */
const MAX_RECORDS = 2000

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

/** 千分位，避免依赖 toLocaleString 在不同机型表现不一致 */
function groupDigits(value) {
  const num = Math.round(Math.abs(Number(value) || 0))
  const str = `${num}`
  let out = ''
  for (let i = 0; i < str.length; i += 1) {
    const rest = str.length - i
    out += str[i]
    if (rest > 1 && (rest - 1) % 3 === 0) out += ','
  }
  return out
}

/**
 * 金额展示：1 万以内显示「¥8,600」，1 万以上显示「¥17.2 万」
 * 只用于展示，排序仍然用原始数值
 */
function formatMoney(value) {
  const num = Number(value) || 0
  if (Math.abs(num) < 10000) return `¥${groupDigits(num)}`
  const wan = num / 10000
  const text = Math.abs(wan) >= 100 ? `${Math.round(wan)}` : `${Math.round(wan * 10) / 10}`
  return `¥${text} 万`
}

/** 解析金额输入，允许为空（按 0 处理），非法返回 NaN */
function parseMoney(text) {
  const trimmed = String(text === undefined || text === null ? '' : text).trim()
  if (!trimmed) return 0
  const num = Number(trimmed.replace(/,/g, ''))
  return isFinite(num) && num >= 0 ? num : NaN
}

/** 深拷贝，避免页面直接改动仓库内对象 */
function clone(data) {
  return JSON.parse(JSON.stringify(data))
}

// ============================================================
// 交付日期
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * 把 2026-11-08 解析成当天 0 点的时间戳
 * 用 0 点而不是当前时刻，保证「同一天」的任务权重一致
 * @param {string} text YYYY-MM-DD
 * @returns {number} 非法格式返回 0
 */
function parseDayTime(text) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(text || '').trim())
  if (!match) return 0

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return 0

  const date = new Date(year, month - 1, day)
  // 2 月 30 日这类非法日期会被 Date 自动顺延，回读对不上就判定为非法
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return 0
  }
  return date.getTime()
}

/** 日期选择器默认值：7 天后 */
function defaultDueDate(createdAt) {
  const base = new Date(createdAt || Date.now())
  return dayKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7))
}

/**
 * 交付日期展示信息：剩余天数、紧张程度
 * level：overdue 逾期 / today 今天 / soon 3 天内 / normal 正常 / none 未设置
 * @param {string} dueDate YYYY-MM-DD
 */
function dueInfoOf(dueDate) {
  const time = parseDayTime(dueDate)
  if (!time) {
    return {
      dueDate: '',
      dueText: '未设置',
      dueFull: '未设置交付日期',
      dueLevel: 'none',
      dueTip: '未设置交付日期',
      dueDays: null
    }
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.round((time - today) / DAY_MS)

  let dueLevel = 'normal'
  let dueTip = `还剩 ${days} 天`
  if (days < 0) {
    dueLevel = 'overdue'
    dueTip = `逾期 ${-days} 天`
  } else if (days === 0) {
    dueLevel = 'today'
    dueTip = '今天交付'
  } else if (days === 1) {
    dueLevel = 'soon'
    dueTip = '明天交付'
  } else if (days <= 3) {
    dueLevel = 'soon'
    dueTip = `还剩 ${days} 天`
  }

  return {
    dueDate,
    dueText: dueDate.slice(5),
    dueFull: `交付 ${dueDate}`,
    dueLevel,
    dueTip,
    dueDays: days
  }
}

// ============================================================
// 初始模拟数据
// ============================================================

/**
 * 演示用供应商（按分类带出）
 * 只用于初始化演示数据；实际以商品上的 supplier 字段为准，可在商品编辑里随时修改
 */
const SEED_SUPPLIERS = {
  机芯结构件: '宁波精工机械',
  电机驱动: '深圳汇川电机',
  电子元件: '东莞立讯电子',
  线束辅料: '苏州联信线束',
  数码配件: '深圳华强数码',
  音频设备: '东莞声学电子',
  智能穿戴: '深圳穿戴科技',
  办公耗材: '上海齐心办公'
}

/** 商品主数据（stock 为当前库存，safeStock 为安全库存下限，supplier 为供应商） */
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
 * 机芯生产物料（机器人头部机芯）
 * 与商品共用同一张库存表，只是分类属于机芯相关，
 * 这样生产领料与普通出入库走同一套库存，不需要两套账。
 */
const SEED_MATERIALS = [
  {
    id: 'M3001',
    sku: 'MT-3001',
    title: '机芯主支架',
    spec: '铝合金 CNC / 阳极氧化',
    barCode: '',
    category: '机芯结构件',
    unit: '件',
    location: 'A-01-01',
    stock: 60,
    safeStock: 20,
    price: 45
  },
  {
    id: 'M3002',
    sku: 'MT-3002',
    title: '头部外壳上盖',
    spec: 'ABS 阻燃 / 磨砂白',
    barCode: '',
    category: '机芯结构件',
    unit: '件',
    location: 'A-01-02',
    stock: 24,
    safeStock: 10,
    price: 32
  },
  {
    id: 'M3003',
    sku: 'MT-3003',
    title: '颈部转动组件',
    spec: '双轴舵机支架',
    barCode: '',
    category: '机芯结构件',
    unit: '件',
    location: 'A-01-04',
    stock: 30,
    safeStock: 8,
    price: 28
  },
  {
    id: 'M3004',
    sku: 'MT-3004',
    title: '微型轴承',
    spec: '608ZZ / 8×22×7',
    barCode: '',
    category: '机芯结构件',
    unit: '个',
    location: 'A-02-02',
    stock: 800,
    safeStock: 200,
    price: 3.5
  },
  {
    id: 'M3005',
    sku: 'MT-3005',
    title: '精密齿轮组',
    spec: '1:5 行星齿轮 / POM',
    barCode: '',
    category: '机芯结构件',
    unit: '套',
    location: 'B-01-01',
    stock: 18,
    safeStock: 10,
    price: 22
  },
  {
    id: 'M3006',
    sku: 'MT-3006',
    title: '无刷伺服电机',
    spec: '2208 / 12V',
    barCode: '',
    category: '电机驱动',
    unit: '台',
    location: 'B-02-02',
    stock: 26,
    safeStock: 10,
    price: 88
  },
  {
    id: 'M3007',
    sku: 'MT-3007',
    title: '行星减速箱',
    spec: '16mm / 1:19',
    barCode: '',
    category: '电机驱动',
    unit: '个',
    location: 'B-02-03',
    stock: 14,
    safeStock: 10,
    price: 56
  },
  {
    id: 'M3008',
    sku: 'MT-3008',
    title: '双路电机驱动板',
    spec: 'TB6612 / 2A',
    barCode: '',
    category: '电机驱动',
    unit: '块',
    location: 'C-01-03',
    stock: 15,
    safeStock: 8,
    price: 38
  },
  {
    id: 'M3009',
    sku: 'MT-3009',
    title: '磁编码器',
    spec: 'AS5600 / I2C',
    barCode: '',
    category: '电机驱动',
    unit: '个',
    location: 'C-01-04',
    stock: 40,
    safeStock: 15,
    price: 12
  },
  {
    id: 'M3010',
    sku: 'MT-3010',
    title: '主控板',
    spec: 'STM32F407 / 六轴',
    barCode: '',
    category: '电子元件',
    unit: '块',
    location: 'C-02-01',
    stock: 9,
    safeStock: 6,
    price: 96
  },
  {
    id: 'M3011',
    sku: 'MT-3011',
    title: '霍尔限位开关',
    spec: 'OH137 / 3.3V',
    barCode: '',
    category: '电子元件',
    unit: '个',
    location: 'C-02-02',
    stock: 120,
    safeStock: 30,
    price: 2.4
  },
  {
    id: 'M3012',
    sku: 'MT-3012',
    title: 'FPC 柔性排线',
    spec: '24P / 0.5mm / 120mm',
    barCode: '',
    category: '电子元件',
    unit: '条',
    location: 'C-03-01',
    stock: 60,
    safeStock: 15,
    price: 5
  },
  {
    id: 'M3013',
    sku: 'MT-3013',
    title: '内六角螺丝',
    spec: 'M2×6 / 不锈钢',
    barCode: '',
    category: '线束辅料',
    unit: '颗',
    location: 'D-03-01',
    stock: 1200,
    safeStock: 300,
    price: 0.12
  },
  {
    id: 'M3014',
    sku: 'MT-3014',
    title: '导热硅脂',
    spec: '3g / 针管装',
    barCode: '',
    category: '线束辅料',
    unit: '支',
    location: 'D-03-02',
    stock: 4,
    safeStock: 5,
    price: 9
  },
  {
    id: 'M3015',
    sku: 'MT-3015',
    title: '防静电标签',
    spec: '30×20mm',
    barCode: '',
    category: '线束辅料',
    unit: '张',
    location: 'D-03-03',
    stock: 300,
    safeStock: 80,
    price: 0.3
  }
]

/**
 * 机芯 BOM（按版本维护，qty 为单台用量）
 * 实际使用时可在「BOM 维护」页增删物料或粘贴导入自己的 BOM
 */
const SEED_BOMS = [
  {
    id: 'BOM-V31',
    version: 'V3.1',
    name: '机器人头部机芯 V3.1',
    remark: '主线版本：双电机 + 磁编码器闭环',
    // 单台机芯价格（元），生产任务按它与计划台数算总价
    price: 8600,
    items: [
      { goodsId: 'M3001', qty: 1 },
      { goodsId: 'M3002', qty: 1 },
      { goodsId: 'M3003', qty: 1 },
      { goodsId: 'M3004', qty: 4 },
      { goodsId: 'M3005', qty: 1 },
      { goodsId: 'M3006', qty: 2 },
      { goodsId: 'M3007', qty: 2 },
      { goodsId: 'M3008', qty: 1 },
      { goodsId: 'M3009', qty: 2 },
      { goodsId: 'M3010', qty: 1 },
      { goodsId: 'M3011', qty: 4 },
      { goodsId: 'M3012', qty: 2 },
      { goodsId: 'M3013', qty: 16 },
      { goodsId: 'M3014', qty: 1 },
      { goodsId: 'M3015', qty: 2 }
    ],
    updatedAt: 0
  },
  {
    id: 'BOM-V30',
    version: 'V3.0',
    name: '机器人头部机芯 V3.0',
    remark: '旧版：单减速箱、无编码器',
    price: 7200,
    items: [
      { goodsId: 'M3001', qty: 1 },
      { goodsId: 'M3002', qty: 1 },
      { goodsId: 'M3004', qty: 2 },
      { goodsId: 'M3005', qty: 1 },
      { goodsId: 'M3006', qty: 2 },
      { goodsId: 'M3007', qty: 1 },
      { goodsId: 'M3008', qty: 1 },
      { goodsId: 'M3011', qty: 2 },
      { goodsId: 'M3013', qty: 12 },
      { goodsId: 'M3015', qty: 1 }
    ],
    updatedAt: 0
  }
]

/** 任务单号：T-20261103-01 */
function makeTaskId(createdAt, seq) {
  const date = new Date(createdAt)
  let seqText = `${seq}`
  while (seqText.length < 2) seqText = `0${seqText}`
  return `T-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${seqText}`
}

/** 初始生产任务：两条并存，方便首次进入就看到多任务优先级与齐套分析 */
function buildSeedTasks() {
  const now = Date.now()
  const dueOf = (days) => dayKey(new Date(now + days * DAY_MS))
  return [
    {
      id: makeTaskId(now, 1),
      bomId: 'BOM-V31',
      version: 'V3.1',
      name: '机器人头部机芯 V3.1',
      planQty: 20,
      doneQty: 0,
      status: 'doing',
      operator: '张伟',
      remark: '首批试产',
      // 本单成交价（演示：与版本价一致）
      unitPrice: 8600,
      receiver: '陈志强',
      receiverCompany: '东莞市智泉机器人有限公司',
      receiverPhone: '13800138000',
      address: '广东省东莞市松山湖园区科技九路 6 号 A 栋 3 楼',
      // 下单日期（演示：3 天前下的单，早于录入时间也不影响）
      orderDate: dueOf(-3),
      dueDate: dueOf(5),
      sortWeight: parseDayTime(dueOf(5)),
      createdAt: now,
      finishedAt: 0,
      time: formatRecordTime(now)
    },
    {
      id: makeTaskId(now, 2),
      bomId: 'BOM-V30',
      version: 'V3.0',
      name: '机器人头部机芯 V3.0',
      planQty: 10,
      doneQty: 0,
      status: 'doing',
      operator: '李娜',
      remark: '客户补单',
      // 本单成交价（演示：比版本价 7200 低 400，只影响这一单）
      unitPrice: 6800,
      receiver: '王敏',
      receiverCompany: '',
      receiverPhone: '13612345678',
      address: '江苏省苏州市吴中区木渎镇金枫路 128 号 2 号厂房',
      // 下单日期（演示：1 天前下的单）
      orderDate: dueOf(-1),
      dueDate: dueOf(9),
      sortWeight: parseDayTime(dueOf(9)),
      createdAt: now - 60 * 1000,
      finishedAt: 0,
      time: formatRecordTime(now - 60 * 1000)
    }
  ]
}

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

/**
 * 数据变化订阅者
 * 任何页面写库（改交付日期、报工、入库…）后都会通知订阅者，
 * 让正在显示的数据页面立即重算，而不是等下一次 onShow
 */
const listeners = []

/** 上一次写本地缓存是否失败：失败时内存数据才是最完整的一份 */
let persistFailed = false

/**
 * 订阅数据变化
 * @param {Function} handler 数据变化后的回调
 * @returns {Function} 取消订阅
 */
function subscribe(handler) {
  if (typeof handler !== 'function') return function () {}
  listeners.push(handler)
  return function unsubscribe() {
    const index = listeners.indexOf(handler)
    if (index !== -1) listeners.splice(index, 1)
  }
}

/** 广播数据变化 */
function notifyChange() {
  listeners.slice().forEach((handler) => {
    try {
      handler()
    } catch (err) {
      console.warn('[WMS] 数据订阅回调出错', err)
    }
  })
}

/** 初始化种子商品时带上示例供应商（已显式写了 supplier 的保持不变） */
function withSeedSupplier(goods) {
  return Object.assign({}, goods, {
    supplier: goods.supplier || SEED_SUPPLIERS[goods.category] || ''
  })
}

function createInitialState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    categories: clone(SEED_CATEGORIES),
    goods: clone(SEED_GOODS)
      .concat(clone(SEED_MATERIALS))
      .map(withSeedSupplier),
    records: buildSeedRecords(),
    goodsSeq: 1000 + SEED_GOODS.length,
    boms: clone(SEED_BOMS),
    tasks: buildSeedTasks(),
    taskSeq: buildSeedTasks().length,
    // 任务列表排序模式：due / amount / created / manual
    taskSortMode: DEFAULT_SORT_MODE
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
    state = migrateState(stored)
  } else {
    state = createInitialState()
    persist()
  }
  return state
}

/**
 * 存量数据迁移（老版本手机缓存升级）
 * v1 → v2：补齐机芯物料、BOM、生产任务；
 * v2 → v3：分类从写死常量改为可维护数据（state.categories）。
 * 已有商品与出入库记录全部保留，已存在的物料不覆盖用户改过的库存。
 * @param {object} data 本地缓存数据
 * @returns {object} 迁移后的数据
 */
function migrateState(data) {
  let changed = false

  // v2 → v3：初始化分类表，并保证兜底分类存在
  if (!Array.isArray(data.categories) || !data.categories.length) {
    data.categories = clone(SEED_CATEGORIES)
    changed = true
  }
  if (!data.categories.some((item) => item.name === FALLBACK_CATEGORY)) {
    data.categories.push({ id: nextCategoryId(data), name: FALLBACK_CATEGORY })
    changed = true
  }
  // 商品上用到的分类若不在分类表里（旧版本或外部导入的数据），补进去，避免商品无从归类
  ;(data.goods || []).forEach((goods) => {
    const name = (goods.category || '').trim()
    if (name && !data.categories.some((item) => item.name === name)) {
      data.categories.push({ id: nextCategoryId(data), name })
      changed = true
    }
  })

  if (!Array.isArray(data.boms)) {
    data.boms = clone(SEED_BOMS)
    changed = true
  }
  if (!Array.isArray(data.tasks)) {
    data.tasks = []
    changed = true
  }
  if (!data.taskSeq) {
    data.taskSeq = 0
    changed = true
  }

  SEED_MATERIALS.forEach((material) => {
    const exists = data.goods.some((item) => item.sku === material.sku)
    if (!exists) {
      data.goods.push(clone(material))
      changed = true
    }
  })

  // v3 增补 supplier 字段：老数据没有供应商，补空串保证页面取值稳定（用户填过的不会被覆盖）
  ;(data.goods || []).forEach((goods) => {
    if (typeof goods.supplier !== 'string') {
      goods.supplier = ''
      changed = true
    }
  })

  // v3 → v4：任务增加交付日期与排序权重，老任务按创建时间 +7 天补一个交付日期
  ;(data.tasks || []).forEach((task) => {
    if (!parseDayTime(task.dueDate)) {
      task.dueDate = defaultDueDate(task.createdAt)
      changed = true
    }
    if (typeof task.sortWeight !== 'number' || !isFinite(task.sortWeight)) {
      task.sortWeight = parseDayTime(task.dueDate) || task.createdAt || 0
      changed = true
    }
  })

  // v4 → v5：BOM 增加单台价格（老数据按种子价格补，找不到就留 0 让用户自己填）
  ;(data.boms || []).forEach((bom) => {
    if (typeof bom.price !== 'number' || !isFinite(bom.price)) {
      const seed = SEED_BOMS.find((item) => item.version === bom.version)
      bom.price = seed ? seed.price : 0
      changed = true
    }
  })

  // v5 → v6：任务增加收货信息（老任务没有，补空串，用户可在任务卡上补填）
  ;(data.tasks || []).forEach((task) => {
    let patched = false
    ;['receiver', 'receiverCompany', 'receiverPhone', 'address'].forEach((key) => {
      if (typeof task[key] !== 'string') {
        task[key] = ''
        patched = true
      }
    })
    if (patched) changed = true
  })

  // v6 → v7：任务增加本单单台价格。老任务按当前版本价格快照一次，
  // 之后就与版本价格脱钩，改版本价不会再影响历史订单
  ;(data.tasks || []).forEach((task) => {
    if (typeof task.unitPrice !== 'number' || !isFinite(task.unitPrice)) {
      const bom = (data.boms || []).find((item) => item.id === task.bomId)
      task.unitPrice = bom ? Number(bom.price) || 0 : 0
      changed = true
    }
  })

  // v7 → v8：任务增加手填的下单日期，老任务按录入时间当天补齐
  ;(data.tasks || []).forEach((task) => {
    if (!parseDayTime(task.orderDate)) {
      task.orderDate = dayKey(new Date(task.createdAt || Date.now()))
      changed = true
    }
  })

  // v4 → v5：任务列表排序模式，默认按交付日期
  if (TASK_SORT_MODES.every((item) => item.key !== data.taskSortMode)) {
    data.taskSortMode = DEFAULT_SORT_MODE
    changed = true
  }

  if (data.schemaVersion !== SCHEMA_VERSION) {
    data.schemaVersion = SCHEMA_VERSION
    changed = true
  }

  state = data
  if (changed) persist()
  return data
}

/**
 * 记录上限保护：超出时按时间倒序保留最新的，丢弃最早的
 * 不假设数组已排序（老数据 / 迁移数据可能是升序），超限时才排一次
 */
function trimRecords(data) {
  if (data.records.length <= MAX_RECORDS) return
  data.records.sort((a, b) => b.createdAt - a.createdAt)
  data.records = data.records.slice(0, MAX_RECORDS)
}

function persist() {
  try {
    wx.setStorageSync(STORAGE_KEY, state)
    persistFailed = false
  } catch (err) {
    // 容量满或写入异常时保留内存数据，避免下一次回读把用户的改动覆盖掉
    persistFailed = true
    console.warn('[WMS] 本地数据写入失败', err)
  }
  // 写库成功与否都通知页面重算：内存里的 state 已经是最新的
  notifyChange()
}

/**
 * 强制按本地缓存重新加载一遍数据
 * 页面 onShow 时调用，确保读到的是别的页面刚写进去的最新数据，
 * 而不是本次启动时缓存下来的旧副本
 * @returns {object} 最新的状态副本
 */
function reload() {
  if (persistFailed && state) return clone(state)
  state = null
  return clone(loadState())
}

// ============================================================
// 分类管理
// 分类是可维护的：可新增、重命名、删除，商品与物料共用一套分类
// ============================================================

/** 生成下一个分类 id：C001、C002… */
function nextCategoryId(data) {
  const ids = ((data && data.categories) || []).map(
    (item) => Number(String(item.id || '').replace(/\D/g, '')) || 0
  )
  const max = ids.length ? Math.max.apply(null, ids) : 0
  return `C${`00${max + 1}`.slice(-3)}`
}

/**
 * 分类列表，带每个分类下的商品数量
 * 按维护顺序返回；「未分类」标记为不可删除
 * @returns {{id: string, name: string, goodsCount: number, removable: boolean}[]}
 */
function listCategories() {
  const current = loadState()
  return current.categories.map((item) => {
    const goodsCount = current.goods.filter((goods) => goods.category === item.name).length
    return {
      id: item.id,
      name: item.name,
      goodsCount,
      removable: item.name !== FALLBACK_CATEGORY
    }
  })
}

/** 分类名称数组（按维护顺序），供筛选条与下拉选择使用 */
function categoryNames() {
  return loadState().categories.map((item) => item.name)
}

/** 新增商品时的默认分类：优先第一个非兜底分类 */
function getDefaultCategory() {
  const names = categoryNames().filter((name) => name !== FALLBACK_CATEGORY)
  return names.length ? names[0] : FALLBACK_CATEGORY
}

/** 分类名称校验，返回清洗后的名称或错误 */
function validateCategoryName(name, excludeId) {
  const text = String(name || '').trim()
  if (!text) return { ok: false, message: '请填写分类名称' }
  if (text.length > 12) return { ok: false, message: '分类名称最多 12 个字' }
  const duplicated = loadState().categories.some(
    (item) => item.name === text && item.id !== excludeId
  )
  if (duplicated) return { ok: false, message: '该分类已存在' }
  if (text === FALLBACK_CATEGORY) return { ok: false, message: '「未分类」为系统保留分类' }
  return { ok: true, name: text }
}

/**
 * 新增分类，追加到列表末尾
 * @param {string} name 分类名称
 */
function addCategory(name) {
  const checked = validateCategoryName(name)
  if (!checked.ok) return checked

  const current = loadState()
  const category = { id: nextCategoryId(current), name: checked.name }
  current.categories.push(category)
  persist()
  return { ok: true, category, message: `已新增分类「${category.name}」` }
}

/**
 * 重命名分类，同步更新该分类下所有商品
 * @param {string} id 分类 id
 * @param {string} name 新名称
 */
function renameCategory(id, name) {
  const current = loadState()
  const category = current.categories.find((item) => item.id === id)
  if (!category) return { ok: false, message: '分类不存在' }
  if (category.name === FALLBACK_CATEGORY) {
    return { ok: false, message: '「未分类」为系统保留分类，不支持重命名' }
  }

  const checked = validateCategoryName(name, id)
  if (!checked.ok) return checked
  if (checked.name === category.name) return { ok: false, message: '分类名称没有变化' }

  const oldName = category.name
  category.name = checked.name

  let affected = 0
  current.goods.forEach((goods) => {
    if (goods.category === oldName) {
      goods.category = checked.name
      affected += 1
    }
  })

  persist()
  let message = `已重命名为「${checked.name}」`
  if (affected) message += `，同步更新 ${affected} 个商品`
  return { ok: true, category, affected, message }
}

/**
 * 删除分类
 * 分类下还有商品时，这些商品会迁移到 moveTo 指定的分类（默认「未分类」）
 * @param {string} id 分类 id
 * @param {{moveTo?: string}} [options]
 */
function removeCategory(id, options) {
  const opts = options || {}
  const current = loadState()
  const index = current.categories.findIndex((item) => item.id === id)
  if (index === -1) return { ok: false, message: '分类不存在' }

  const category = current.categories[index]
  if (category.name === FALLBACK_CATEGORY) {
    return { ok: false, message: '「未分类」为系统保留分类，不能删除' }
  }
  if (current.categories.length <= 1) {
    return { ok: false, message: '至少需要保留一个分类' }
  }

  // 迁移目标：调用方指定且存在，否则退到兜底分类
  let target = FALLBACK_CATEGORY
  if (
    opts.moveTo &&
    opts.moveTo !== category.name &&
    current.categories.some((item) => item.name === opts.moveTo)
  ) {
    target = opts.moveTo
  }

  let moved = 0
  current.goods.forEach((goods) => {
    if (goods.category === category.name) {
      goods.category = target
      moved += 1
    }
  })

  current.categories.splice(index, 1)
  persist()

  let message = `已删除分类「${category.name}」`
  if (moved) message += `，${moved} 个商品已移到「${target}」`
  return { ok: true, moved, target, message }
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
    supplier: typeof goods.supplier === 'string' ? goods.supplier : '',
    status,
    statusText: STOCK_STATUS_TEXT[status]
  })
}

/**
 * 查询商品列表
 * @param {object} options
 * @param {string} [options.keyword] 名称 / SKU / 条码 / 供应商 模糊匹配
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
        (goods.barCode || '').toLowerCase().indexOf(keyword) !== -1 ||
        (goods.supplier || '').toLowerCase().indexOf(keyword) !== -1
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
  data.category = (data.category || '').trim() || getDefaultCategory()
  data.unit = (data.unit || '件').trim() || '件'
  data.location = (data.location || '').trim()
  data.supplier = (data.supplier || '').trim()
  data.stock = Number(data.stock) || 0
  data.safeStock = Number(data.safeStock) || 0
  data.price = Number(data.price) || 0

  if (!data.title) return { ok: false, message: '请填写商品名称' }
  if (!data.sku) return { ok: false, message: '请填写商品 SKU' }
  if (data.supplier.length > 40) return { ok: false, message: '供应商名称最多 40 个字' }
  if (data.stock < 0) return { ok: false, message: '库存不能小于 0' }
  if (data.safeStock < 0) return { ok: false, message: '安全库存不能小于 0' }

  const current = loadState()
  // 分类必须存在于分类表中，否则归到兜底分类，避免出现筛选不到的商品
  if (!current.categories.some((item) => item.name === data.category)) {
    data.category = FALLBACK_CATEGORY
  }
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

  // 时间文案按当前时间重新计算：记录里存的是写入时刻的相对时间，
  // 隔天再看会把「昨天 09:15」显示成「09:15」
  result.forEach((item) => {
    item.time = formatRecordTime(item.createdAt)
  })

  return clone(result)
}

/** 生产领料记录：type 记为出库，靠 taskId 区分 */
function isPickRecord(record) {
  return record.type === 'out' && !!record.taskId
}

/**
 * 最近操作：按「一次操作」聚合，供首页展示
 * 生产报工一次会按物料写十几条领料记录，原样列出会把首页挤满，
 * 也会和「今日出库」按单统计的数字对不上。
 * 这里把同一批报工（taskId + createdAt 相同）合成一条，物料明细放在 lines 里。
 * @param {{limit?: number}} [options]
 */
function listRecentOps(options) {
  const opts = options || {}
  const limit = opts.limit || 5
  const sorted = loadState()
    .records.slice()
    .sort((a, b) => b.createdAt - a.createdAt)

  const ops = []
  const pickMap = {}

  sorted.forEach((record) => {
    const time = formatRecordTime(record.createdAt)

    if (isPickRecord(record)) {
      const key = `pick-${record.taskId}-${record.createdAt}`
      const line = {
        id: record.id,
        title: record.title,
        sku: record.sku,
        spec: record.spec,
        quantity: record.quantity,
        unit: record.unit
      }

      const exist = pickMap[key]
      if (exist) {
        exist.lines.push(line)
        exist.itemCount += 1
        exist.totalQty += record.quantity
        exist.metaTop = `${exist.taskQty} 台 · ${exist.itemCount} 种物料`
        exist.qtyText = `${exist.itemCount} 种`
        return
      }

      const version = record.taskVersion || ''
      const taskQty = record.taskQty || 0
      const op = {
        key,
        kind: 'pick',
        typeText: '领料',
        title: version ? `${version} 机芯生产领料` : '机芯生产领料',
        metaTop: `${taskQty} 台 · 1 种物料`,
        metaBottom: `${time} · ${record.operator}`,
        qtyText: '1 种',
        quantity: record.quantity,
        unit: record.unit,
        totalQty: record.quantity,
        itemCount: 1,
        lines: [line],
        operator: record.operator,
        location: record.location || '',
        remark: record.remark || '',
        taskId: record.taskId,
        taskVersion: version,
        taskQty,
        createdAt: record.createdAt,
        time
      }
      pickMap[key] = op
      ops.push(op)
      return
    }

    ops.push({
      key: `rec-${record.id}`,
      kind: record.type,
      id: record.id,
      typeText: record.typeText,
      title: record.title,
      sku: record.sku || '',
      spec: record.spec || '',
      metaTop: record.spec ? `${record.sku} · ${record.spec}` : record.sku,
      metaBottom: `${time} · ${record.operator} · ${record.location || '未设置库位'}`,
      qtyText: `${record.type === 'in' ? '+' : '-'}${record.quantity}${record.unit}`,
      quantity: record.quantity,
      unit: record.unit,
      totalQty: record.quantity,
      itemCount: 0,
      lines: [],
      operator: record.operator,
      location: record.location || '',
      remark: record.remark || '',
      createdAt: record.createdAt,
      time
    })
  })

  return clone(ops.slice(0, limit))
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
  trimRecords(current)
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

  const seenPick = {}
  current.records.forEach((record) => {
    if (dayKey(new Date(record.createdAt)) !== today) return
    if (record.type === 'in') {
      inboundCount += 1
      return
    }
    // 生产领料按物料逐条写入，统计「单数」时同一次报工只算一单
    if (record.taskId) {
      const key = `${record.taskId}-${record.createdAt}`
      if (seenPick[key]) return
      seenPick[key] = true
    }
    outboundCount += 1
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

// ============================================================
// BOM（机芯物料清单，按版本维护）
// ============================================================

/** 版本号降序比较：V3.2 → V3.1 → V3.0 */
function compareVersion(a, b) {
  const pa = String(a.version || '').replace(/[^\d.]/g, '').split('.').map(Number)
  const pb = String(b.version || '').replace(/[^\d.]/g, '').split('.').map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const diff = (pb[i] || 0) - (pa[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** 给 BOM 补上物料明细（名称、库存等），便于页面直接渲染 */
function decorateBom(bom) {
  const current = loadState()
  const items = bom.items.map((line) => {
    const goods = current.goods.find((item) => item.id === line.goodsId)
    return {
      goodsId: line.goodsId,
      qty: Number(line.qty) || 0,
      title: goods ? goods.title : '（物料已删除）',
      sku: goods ? goods.sku : '-',
      spec: goods ? goods.spec : '',
      unit: goods ? goods.unit : '',
      stock: goods ? goods.stock : 0,
      safeStock: goods ? goods.safeStock : 0,
      price: goods ? goods.price : 0,
      missing: !goods
    }
  })

  return {
    id: bom.id,
    version: bom.version,
    name: bom.name,
    remark: bom.remark || '',
    // 单台机芯价格（元）
    price: Number(bom.price) || 0,
    priceText: formatMoney(bom.price),
    // 物料成本合计（按商品采购价 × 单台用量），可用来对比售价
    cost: Math.round(
      items.reduce((sum, item) => sum + (Number(item.price) || 0) * item.qty, 0) * 100
    ) / 100,
    costText: formatMoney(
      items.reduce((sum, item) => sum + (Number(item.price) || 0) * item.qty, 0)
    ),
    updatedAt: bom.updatedAt || 0,
    items,
    itemCount: items.length,
    totalQty: items.reduce((sum, item) => sum + item.qty, 0)
  }
}

/** BOM 列表（按版本从新到旧） */
function listBoms() {
  return loadState()
    .boms.slice()
    .sort(compareVersion)
    .map(decorateBom)
}

/** BOM 详情，含物料明细 */
function getBom(id) {
  const bom = loadState().boms.find((item) => item.id === id)
  return bom ? decorateBom(bom) : null
}

/** 内部使用：取原始 BOM 引用（可直接修改） */
function getRawBom(id) {
  return loadState().boms.find((item) => item.id === id) || null
}

/**
 * 新增 / 修改 BOM 版本信息
 * @param {{id?: string, version: string, name?: string, remark?: string}} payload
 */
function saveBom(payload) {
  const data = payload || {}
  const version = (data.version || '').trim()
  const current = loadState()

  if (!version) return { ok: false, message: '请填写版本号，如 V3.1' }

  const price = parseMoney(data.price)
  if (isNaN(price)) return { ok: false, message: '单台价格需为大于等于 0 的数字' }
  if (price > 10000000) return { ok: false, message: '单台价格过大' }

  const duplicated = current.boms.find(
    (item) => item.version.toLowerCase() === version.toLowerCase() && item.id !== data.id
  )
  if (duplicated) return { ok: false, message: '该版本号已存在' }

  if (data.id) {
    const bom = getRawBom(data.id)
    if (!bom) return { ok: false, message: 'BOM 不存在' }
    bom.version = version
    bom.name = (data.name || '').trim() || `机器人头部机芯 ${version}`
    bom.remark = (data.remark || '').trim()
    bom.price = price
    bom.updatedAt = Date.now()
    persist()
    return { ok: true, bom: decorateBom(bom) }
  }

  let baseId = `BOM-${version.toUpperCase().replace(/[^A-Z0-9]/g, '')}`
  let id = baseId
  let seq = 1
  while (current.boms.some((item) => item.id === id)) {
    seq += 1
    id = `${baseId}-${seq}`
  }

  const bom = {
    id,
    version,
    name: (data.name || '').trim() || `机器人头部机芯 ${version}`,
    remark: (data.remark || '').trim(),
    price,
    items: [],
    updatedAt: Date.now()
  }
  current.boms.push(bom)
  persist()
  return { ok: true, bom: decorateBom(bom) }
}

/** 删除 BOM 版本（有进行中任务引用时禁止删除） */
function removeBom(id) {
  const current = loadState()
  const index = current.boms.findIndex((item) => item.id === id)
  if (index === -1) return { ok: false, message: 'BOM 不存在' }

  const inUse = current.tasks.some((task) => task.bomId === id && task.status === 'doing')
  if (inUse) return { ok: false, message: '该版本有进行中的生产任务，不能删除' }

  current.boms.splice(index, 1)
  persist()
  return { ok: true }
}

/**
 * 新增 / 修改 BOM 物料行
 * @param {{bomId: string, goodsId: string, qty: number}} payload
 */
function saveBomItem(payload) {
  const data = payload || {}
  const bom = getRawBom(data.bomId)
  if (!bom) return { ok: false, message: 'BOM 不存在' }

  const goods = loadState().goods.find((item) => item.id === data.goodsId)
  if (!goods) return { ok: false, message: '请选择物料' }

  const qty = Number(data.qty)
  if (!qty || qty <= 0 || !Number.isInteger(qty)) {
    return { ok: false, message: '单台用量需为大于 0 的整数' }
  }

  const line = bom.items.find((item) => item.goodsId === goods.id)
  if (line) line.qty = qty
  else bom.items.push({ goodsId: goods.id, qty })

  bom.updatedAt = Date.now()
  persist()
  return { ok: true, bom: decorateBom(bom) }
}

/** 删除 BOM 物料行 */
function removeBomItem(bomId, goodsId) {
  const bom = getRawBom(bomId)
  if (!bom) return { ok: false, message: 'BOM 不存在' }

  const index = bom.items.findIndex((item) => item.goodsId === goodsId)
  if (index === -1) return { ok: false, message: '该物料不在 BOM 中' }

  bom.items.splice(index, 1)
  bom.updatedAt = Date.now()
  persist()
  return { ok: true, bom: decorateBom(bom) }
}

/**
 * 解析 BOM 文本的一行
 * 支持「物料编码 单台用量」，分隔符可以是空格 / 制表符 / 逗号 / 分号，
 * 也兼容「编码,名称,规格,数量」这种从 Excel 直接复制的行（取首列与末列数字）
 * @param {string} line
 * @returns {{code: string, qty: number}|null}
 */
function parseBomLine(line) {
  const text = String(line || '')
    .replace(/["']/g, '')
    .replace(/[，,;；\t]+/g, ' ')
    .trim()
  if (!text) return null

  const parts = text.split(/\s+/).filter(Boolean)
  if (parts.length < 2) return null

  const qty = Number(parts[parts.length - 1])
  if (!isFinite(qty) || qty <= 0) return null

  const code = parts[0]
  // 过滤表头
  if (/用量|数量|qty|合计|备注/i.test(code) && isNaN(Number(code))) return null

  return { code, qty: Math.floor(qty) }
}

/**
 * 粘贴导入 BOM
 * 每行格式：物料编码（或 SKU / 名称） + 单台用量
 * 已存在的物料会更新用量，不存在的追加
 * @param {string} bomId
 * @param {string} text
 */
function importBomText(bomId, text) {
  const bom = getRawBom(bomId)
  if (!bom) return { ok: false, message: 'BOM 不存在' }

  const current = loadState()
  let added = 0
  let updated = 0
  const unmatched = []

  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const parsed = parseBomLine(line)
      if (!parsed) return

      const keyword = parsed.code.toLowerCase()
      const goods =
        current.goods.find(
          (item) =>
            item.sku.toLowerCase() === keyword ||
            item.id.toLowerCase() === keyword ||
            (item.barCode || '').toLowerCase() === keyword
        ) || current.goods.find((item) => item.title.indexOf(parsed.code) !== -1)

      if (!goods) {
        unmatched.push(parsed.code)
        return
      }

      const exist = bom.items.find((item) => item.goodsId === goods.id)
      if (exist) {
        exist.qty = parsed.qty
        updated += 1
      } else {
        bom.items.push({ goodsId: goods.id, qty: parsed.qty })
        added += 1
      }
    })

  if (!added && !updated) {
    return {
      ok: false,
      message: unmatched.length
        ? `未匹配到物料：${unmatched.slice(0, 3).join('、')}`
        : '未识别到有效行，请按「物料编码 用量」每行一条填写'
    }
  }

  bom.updatedAt = Date.now()
  persist()

  let message = `导入完成：新增 ${added} 项，更新 ${updated} 项`
  if (unmatched.length) message += `，${unmatched.length} 项未匹配`
  return { ok: true, message, added, updated, unmatched }
}

// ============================================================
// 物料齐套分析
// ============================================================

/**
 * 计算某个 BOM 在指定计划数量下的物料需求
 * 物料状态：
 *   short 库存不足，需要采购
 *   warn  做完这一单后会低于安全库存（含正好用完）
 *   ok    充足
 * @param {object} bom 原始 BOM
 * @param {number} planQty 计划生产台数
 */
function analyzeBom(bom, planQty) {
  if (!bom) return null
  const current = loadState()
  const qty = Math.max(0, Math.floor(Number(planQty) || 0))

  const items = bom.items.map((line) => {
    const goods = current.goods.find((item) => item.id === line.goodsId)
    const perUnit = Number(line.qty) || 0
    const need = perUnit * qty

    if (!goods) {
      return {
        goodsId: line.goodsId,
        title: '（物料已删除）',
        sku: '-',
        spec: '',
        unit: '',
        category: '',
        qtyPerUnit: perUnit,
        need,
        stock: 0,
        safeStock: 0,
        gap: need,
        after: -need,
        maxUnits: 0,
        status: 'short',
        statusText: '物料档案缺失',
        price: 0,
        amount: 0
      }
    }

    const gap = need - goods.stock
    const after = goods.stock - need
    let status = 'ok'
    if (gap > 0) status = 'short'
    else if (after <= goods.safeStock) status = 'warn'

    let statusText = `余 ${after}`
    if (status === 'short') statusText = `缺 ${gap}`
    else if (after === 0) statusText = '做完即用完'

    return {
      goodsId: goods.id,
      title: goods.title,
      sku: goods.sku,
      spec: goods.spec,
      unit: goods.unit,
      category: goods.category,
      qtyPerUnit: perUnit,
      need,
      stock: goods.stock,
      safeStock: goods.safeStock,
      gap: gap > 0 ? gap : 0,
      after,
      maxUnits: perUnit > 0 ? Math.floor(goods.stock / perUnit) : 0,
      status,
      statusText,
      price: goods.price,
      // 单价可能带小数（如 0.12 元/颗），保留两位避免浮点误差
      amount: Math.round((gap > 0 ? gap : 0) * goods.price * 100) / 100
    }
  })

  const order = { short: 0, warn: 1, ok: 2 }
  items.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status]
    if (a.status === 'short') return b.gap - a.gap
    return a.after - b.after
  })

  const shorts = items.filter((item) => item.status === 'short')
  const warns = items.filter((item) => item.status === 'warn')
  const maxAssemble = items.length ? Math.min.apply(null, items.map((item) => item.maxUnits)) : 0
  const purchaseAmount = shorts.reduce((sum, item) => sum + item.amount, 0)

  return {
    bomId: bom.id,
    version: bom.version,
    name: bom.name,
    planQty: qty,
    items,
    shorts,
    warns,
    summary: {
      planQty: qty,
      totalKinds: items.length,
      shortKinds: shorts.length,
      warnKinds: warns.length,
      okKinds: items.length - shorts.length - warns.length,
      shortQty: shorts.reduce((sum, item) => sum + item.gap, 0),
      purchaseAmount: Math.round(purchaseAmount * 100) / 100,
      maxAssemble,
      canFinish: shorts.length === 0 && maxAssemble >= qty && items.length > 0
    }
  }
}

/**
 * 按 BOM + 计划数量做齐套分析
 * @param {{bomId: string, planQty: number}} options
 */
function analyzeTask(options) {
  const opts = options || {}
  const bom = getRawBom(opts.bomId)
  if (!bom) return null
  return analyzeBom(bom, opts.planQty)
}

// ============================================================
// 生产任务
// ============================================================

function getRawTask(taskId) {
  return loadState().tasks.find((item) => item.id === taskId) || null
}

/**
 * 下单时间：优先用手填的下单日期（业务上的实际下单日，可以早于录入日），
 * 老数据没有就退回录入时间并归到当天 0 点，保证与日期同量纲
 */
function orderTimeOf(task) {
  const day = parseDayTime(task.orderDate)
  if (day) return day
  const created = new Date(task.createdAt || 0)
  return new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime()
}

/** 排序权重：手动排序用的顺序值，没调过就退回交付日期 */
function taskWeightOf(task) {
  if (typeof task.sortWeight === 'number' && isFinite(task.sortWeight)) return task.sortWeight
  return parseDayTime(task.dueDate) || task.createdAt || 0
}

/**
 * 任务单台价格：以任务自己存的为准（每单价格可以不同），
 * 老数据或未设置时退回版本价格
 */
function taskUnitPriceOf(task) {
  if (task && typeof task.unitPrice === 'number' && isFinite(task.unitPrice)) {
    return task.unitPrice
  }
  const bom = task ? getRawBom(task.bomId) : null
  return bom ? Number(bom.price) || 0 : 0
}

/** 任务总价 = 该任务单台价格 × 计划台数 */
function taskAmountOf(task) {
  return taskUnitPriceOf(task) * (Number(task.planQty) || 0)
}

/** 当前排序模式：due（交付日期）/ amount（总价）/ created（下单时间）/ manual（手动） */
function getTaskSortMode() {
  const mode = loadState().taskSortMode
  return TASK_SORT_MODES.some((item) => item.key === mode) ? mode : DEFAULT_SORT_MODE
}

/**
 * 任务排序：进行中在前，再按当前排序模式
 * - due：交付日期早的在前
 * - amount：总价高的在前
 * - created：下单早的在前（先下的先做）
 * - manual：手动权重，即用户拖动 / 编号后的顺序
 * 同值统一用创建时间兜底，保证顺序稳定
 */
function compareTaskOrder(a, b) {
  const aDone = a.status === 'done' ? 1 : 0
  const bDone = b.status === 'done' ? 1 : 0
  if (aDone !== bDone) return aDone - bDone

  const mode = getTaskSortMode()
  let diff = 0
  if (mode === 'amount') {
    diff = taskAmountOf(b) - taskAmountOf(a)
  } else if (mode === 'created') {
    // 按手填的下单日期，同一天再按录入时间，保证顺序稳定
    diff = orderTimeOf(a) - orderTimeOf(b)
  } else if (mode === 'manual') {
    diff = taskWeightOf(a) - taskWeightOf(b)
  } else {
    diff = (parseDayTime(a.dueDate) || 0) - (parseDayTime(b.dueDate) || 0)
  }
  if (diff !== 0) return diff
  return (a.createdAt || 0) - (b.createdAt || 0)
}

/** 进行中的任务，按当前排序模式排好 */
function sortedDoingTasks() {
  return loadState()
    .tasks.filter((task) => task.status === 'doing')
    .sort(compareTaskOrder)
}

/**
 * 按给定顺序重排手动权重
 * 先把已有权重排序去重递增（同一天交付的两条也能区分），再按新顺序回填
 */
function applyTaskOrder(ordered) {
  if (!ordered.length) return
  const weights = ordered.map(taskWeightOf).sort((a, b) => a - b)
  for (let i = 1; i < weights.length; i += 1) {
    if (weights[i] <= weights[i - 1]) weights[i] = weights[i - 1] + 1
  }
  ordered.forEach((task, index) => {
    task.sortWeight = weights[index]
  })
}

/** 把日期文本规范成 YYYY-MM-DD，非法返回空串 */
function normalizeDay(text) {
  const time = parseDayTime(text)
  if (!time) return ''
  return dayKey(new Date(time))
}

/** 给任务补上进度、齐套概览、交付日期与金额 */
function decorateTask(task) {
  const bom = getRawBom(task.bomId)
  const analysis = analyzeBom(bom, task.planQty)
  const progress =
    task.planQty > 0 ? Math.min(100, Math.round((task.doneQty / task.planQty) * 100)) : 0
  const due = dueInfoOf(task.dueDate)
  // 已完成的任务不再按逾期提醒，只保留交付日期
  if (task.status === 'done') {
    due.dueLevel = 'done'
    due.dueTip = '已完成'
  }

  // 金额：单价以本任务为准（同一版本不同客户价格可以不同），版本价格只作参考
  const unitPrice = taskUnitPriceOf(task)
  const bomPrice = bom ? Number(bom.price) || 0 : 0
  const planQty = Number(task.planQty) || 0
  const doneQty = Number(task.doneQty) || 0

  return Object.assign({}, task, due, {
    statusText: task.status === 'done' ? '已完成' : '进行中',
    // 同版本可能有多条任务，用单号尾号区分
    idShort: String(task.id || '').slice(-2),
    remarkText: task.remark || '',
    // 下单日期：手填优先，没填就按录入时间当天
    orderDate: task.orderDate || dayKey(new Date(task.createdAt || Date.now())),
    // 首页卡片位置紧，只显示月-日
    orderShort: (task.orderDate || dayKey(new Date(task.createdAt || Date.now()))).slice(5),
    // 收货信息展示字段
    receiverName: task.receiver || '',
    receiverCompanyText: task.receiverCompany || '',
    receiverPhoneText: task.receiverPhone || '',
    addressText: task.address || '',
    // 姓名与公司合一行展示：公司 · 姓名（只填一个就显示一个）
    receiverTitle: [task.receiverCompany, task.receiver].filter(Boolean).join(' · '),
    hasReceiver: !!(task.receiver || task.receiverCompany || task.address),
    remainQty: Math.max(0, planQty - doneQty),
    progress,
    hasBom: !!analysis,
    summary: analysis ? analysis.summary : null,
    // 价格与金额
    unitPrice,
    unitPriceText: formatMoney(unitPrice),
    // 版本参考价：与任务单价不同时页面提示「已单独定价」
    bomPrice,
    bomPriceText: formatMoney(bomPrice),
    priceCustom: bomPrice !== unitPrice,
    amount: unitPrice * planQty,
    amountText: formatMoney(unitPrice * planQty),
    doneAmount: unitPrice * doneQty,
    doneAmountText: formatMoney(unitPrice * doneQty),
    hasPrice: unitPrice > 0
  })
}

/** 任务列表（进行中在前，再按优先级） */
function listTasks() {
  return loadState()
    .tasks.slice()
    .sort(compareTaskOrder)
    .map(decorateTask)
}

/** 任务详情（含齐套分析） */
function getTaskAnalysis(taskId) {
  const task = getRawTask(taskId)
  if (!task) return null
  return {
    task: decorateTask(task),
    analysis: analyzeBom(getRawBom(task.bomId), task.planQty)
  }
}

/** 当前任务：优先级最高的未完成任务（默认就是交付日期最早的那条） */
function getCurrentTask() {
  const doing = listTasks().filter((task) => task.status === 'doing')
  return doing.length ? doing[0] : null
}

/**
 * 首页任务看板：所有进行中的任务，同等级平铺
 * 每条补上优先级序号与能否上移/下移，页面直接渲染
 */
function getTaskBoard() {
  const mode = getTaskSortMode()
  const tasks = listTasks().filter((task) => task.status === 'doing')
  const board = tasks.map((task, index) =>
    Object.assign({}, task, {
      priority: index + 1,
      canMoveUp: index > 0,
      canMoveDown: index < tasks.length - 1
    })
  )

  return {
    tasks: board,
    total: board.length,
    sortMode: mode,
    sortModes: TASK_SORT_MODES.map((item) => Object.assign({}, item, { active: item.key === mode })),
    totalAmount: board.reduce((sum, task) => sum + task.amount, 0),
    totalAmountText: formatMoney(board.reduce((sum, task) => sum + task.amount, 0)),
    overdueCount: board.filter((task) => task.dueLevel === 'overdue').length,
    shortCount: board.filter((task) => task.summary && task.summary.shortKinds > 0).length
  }
}

/**
 * 切换任务排序模式
 * 切到「手动排序」时，先把当前看到的顺序固化成权重，避免顺序突然跳变
 * @param {'due'|'amount'|'created'|'manual'} mode
 */
function setTaskSortMode(mode) {
  const target = TASK_SORT_MODES.find((item) => item.key === mode)
  if (!target) return { ok: false, message: '不支持的排序方式' }

  const current = loadState()
  if (mode === 'manual' && current.taskSortMode !== 'manual') {
    // 用切换前的排序结果作为初始手动顺序
    applyTaskOrder(sortedDoingTasks())
  }

  current.taskSortMode = mode
  persist()
  return { ok: true, mode, label: target.label }
}

/**
 * 手动调整优先级：只在进行中的任务之间挪动
 * 做法是按新顺序重新分配整列权重，这样同一天交付的两个任务也能互换位置
 * @param {string} taskId
 * @param {'up'|'down'} direction
 */
function moveTask(taskId, direction) {
  const doing = sortedDoingTasks()
  const index = doing.findIndex((task) => task.id === taskId)
  if (index === -1) return { ok: false, message: '任务不存在或已完成' }

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0) return { ok: false, message: '已经是最高优先级' }
  if (target >= doing.length) return { ok: false, message: '已经是最低优先级' }

  const moved = doing.splice(index, 1)[0]
  doing.splice(target, 0, moved)
  applyTaskOrder(doing)

  // 手动挪过之后就是手动排序模式，否则下次自动排序会把顺序冲掉
  loadState().taskSortMode = 'manual'
  persist()
  return { ok: true, position: target + 1 }
}

/**
 * 直接设置某条任务排第几（手动编号 1、2、3…）
 * @param {string} taskId
 * @param {number} position 从 1 开始
 */
function setTaskPriority(taskId, position) {
  const doing = sortedDoingTasks()
  const index = doing.findIndex((task) => task.id === taskId)
  if (index === -1) return { ok: false, message: '任务不存在或已完成' }

  const wanted = Math.floor(Number(position))
  if (!wanted || wanted < 1) return { ok: false, message: '请输入 1 以上的序号' }
  if (wanted > doing.length) {
    return { ok: false, message: `最多只能排到第 ${doing.length} 位` }
  }

  const target = wanted - 1
  if (target !== index) {
    const moved = doing.splice(index, 1)[0]
    doing.splice(target, 0, moved)
    applyTaskOrder(doing)
  }

  loadState().taskSortMode = 'manual'
  persist()
  return { ok: true, position: target + 1 }
}

/** 恢复「按交付日期自动排序」：切回日期模式，并把权重重置回交付日期 */
function resetTaskOrder() {
  const current = loadState()
  current.tasks.forEach((task) => {
    task.sortWeight = parseDayTime(task.dueDate) || task.createdAt || 0
  })
  current.taskSortMode = 'due'
  persist()
  return { ok: true }
}

/**
 * 修改交付日期
 * 权重同步回到新日期对应的位置，相当于这条任务重新按日期插队
 * @param {string} taskId
 * @param {string} dueDate YYYY-MM-DD
 */
function setTaskDueDate(taskId, dueDate) {
  const task = getRawTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }

  const day = normalizeDay(dueDate)
  if (!day) return { ok: false, message: '请选择交付日期' }

  // 交付不能早于下单，避免出现「先交付后下单」的怪数据
  const orderDay = task.orderDate || dayKey(new Date(task.createdAt || Date.now()))
  if (parseDayTime(day) < parseDayTime(orderDay)) {
    return { ok: false, message: `交付日期不能早于下单日期（${orderDay}）` }
  }

  task.dueDate = day
  task.sortWeight = parseDayTime(day)
  persist()
  return { ok: true, task: decorateTask(task) }
}

/**
 * 修改下单日期（业务上的实际下单日，可以早于录入时间）
 * 「按下单时间」排序用的就是这个日期
 */
function setTaskOrderDate(taskId, orderDate) {
  const task = getRawTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }

  const day = normalizeDay(orderDate)
  if (!day) return { ok: false, message: '请选择下单日期' }
  if (parseDayTime(day) > parseDayTime(task.dueDate)) {
    return { ok: false, message: `下单日期不能晚于交付日期（${task.dueDate}）` }
  }

  task.orderDate = day
  persist()
  return { ok: true, task: decorateTask(task) }
}

/**
 * 修改某一单的单台价格（不影响同版本的其他任务）
 * 传空串表示恢复跟随版本价格
 */
function updateTaskPrice(taskId, price) {
  const task = getRawTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }

  const text = String(price === undefined || price === null ? '' : price).trim()
  if (!text) {
    // 恢复默认：删掉本单价格，展示与计算都回到版本价格
    delete task.unitPrice
    persist()
    return { ok: true, task: decorateTask(task), reset: true }
  }

  const parsed = parseMoney(text)
  if (isNaN(parsed)) return { ok: false, message: '单台价格需为数字' }
  if (parsed > 10000000) return { ok: false, message: '单台价格过大' }

  task.unitPrice = parsed
  persist()
  return { ok: true, task: decorateTask(task) }
}

/** 字段清洗：去首尾空格并截断，避免超长文本把卡片撑坏 */
function cutText(value, max) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return max && text.length > max ? text.slice(0, max) : text
}

/**
 * 收货信息清洗：收货人 / 收货单位 / 联系电话 / 收货地址
 * 姓名与公司二选一即可（有的客户只留公司名），都填就一起展示
 */
function normalizeReceiver(payload) {
  const data = payload || {}
  const phoneRaw = cutText(data.receiverPhone, 20)
  // 只保留数字与开头的 +，粘贴进来带空格、横线的手机号也能存
  const phoneDigits = phoneRaw.replace(/[^\d]/g, '')
  const phone = phoneRaw
    ? `${phoneRaw.charAt(0) === '+' ? '+' : ''}${phoneDigits}`
    : ''
  return {
    receiver: cutText(data.receiver, 20),
    receiverCompany: cutText(data.receiverCompany, 40),
    receiverPhone: phone,
    address: cutText(data.address, 80)
  }
}

/** 电话校验：填了就必须像号码（6~15 位数字），不填不拦 */
function checkPhone(phone) {
  if (!phone) return ''
  const digits = phone.replace(/[^\d]/g, '')
  if (digits.length < 6 || digits.length > 15) return '联系电话位数不对，请检查'
  return ''
}

/**
 * 修改收货信息（任务卡上点「修改」直接改）
 * @param {string} taskId
 * @param {{receiver?: string, receiverCompany?: string, receiverPhone?: string, address?: string}} payload
 */
function updateTaskReceiver(taskId, payload) {
  const task = getRawTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }

  const info = normalizeReceiver(payload)
  if (!info.receiver && !info.receiverCompany) {
    return { ok: false, message: '请填写收货人或收货单位' }
  }
  if (!info.address) return { ok: false, message: '请填写收货地址' }
  const phoneError = checkPhone(info.receiverPhone)
  if (phoneError) return { ok: false, message: phoneError }

  task.receiver = info.receiver
  task.receiverCompany = info.receiverCompany
  task.receiverPhone = info.receiverPhone
  task.address = info.address
  persist()
  return { ok: true, task: decorateTask(task) }
}

/**
 * 新建生产任务
 * @param {{bomId: string, planQty: number, dueDate?: string, receiver?: string,
 *          receiverCompany?: string, receiverPhone?: string, address?: string,
 *          remark?: string, operator?: string}} payload
 */
function saveTask(payload) {
  const data = payload || {}
  const current = loadState()
  const bom = getRawBom(data.bomId)
  if (!bom) return { ok: false, message: '请选择机芯版本' }

  const planQty = Math.floor(Number(data.planQty) || 0)
  if (planQty <= 0) return { ok: false, message: '计划数量需大于 0' }
  if (planQty > 100000) return { ok: false, message: '计划数量过大' }

  const receiver = normalizeReceiver(data)
  // 收货信息允许先空着后补；但只要填了，就必须成套填写，避免存成半截信息发不出去
  if (receiver.receiver || receiver.receiverCompany || receiver.address) {
    if (!receiver.receiver && !receiver.receiverCompany) {
      return { ok: false, message: '请填写收货人或收货单位' }
    }
    if (!receiver.address) return { ok: false, message: '请填写收货地址' }
    const phoneError = checkPhone(receiver.receiverPhone)
    if (phoneError) return { ok: false, message: phoneError }
  }

  current.taskSeq = (current.taskSeq || 0) + 1
  const createdAt = Date.now()
  // 每单可以单独定价：不填就沿用版本价格，填了只影响这一单
  let unitPrice = Number(bom.price) || 0
  const rawPrice = data.unitPrice
  if (rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '') {
    const parsed = parseMoney(rawPrice)
    if (isNaN(parsed)) return { ok: false, message: '单台价格需为数字' }
    if (parsed > 10000000) return { ok: false, message: '单台价格过大' }
    unitPrice = parsed
  }
  // 交付日期必填，没选就默认 7 天后，保证按日期排序时这条任务有确定位置
  const dueDate = normalizeDay(data.dueDate) || defaultDueDate(createdAt)
  // 下单日期：手填的实际下单日（可以早于录入日），不填按今天
  const orderDate = normalizeDay(data.orderDate) || dayKey(new Date(createdAt))
  if (parseDayTime(orderDate) > parseDayTime(dueDate)) {
    return { ok: false, message: '下单日期不能晚于交付日期' }
  }
  const task = {
    id: makeTaskId(createdAt, current.taskSeq),
    bomId: bom.id,
    version: bom.version,
    name: bom.name,
    planQty,
    doneQty: 0,
    status: 'doing',
    operator: data.operator || '张伟',
    remark: (data.remark || '').trim(),
    // 本单单台成交价（元/台），与版本价格解耦，改价只影响这一单
    unitPrice,
    // 收货信息：发货、送货时用
    receiver: receiver.receiver,
    receiverCompany: receiver.receiverCompany,
    receiverPhone: receiver.receiverPhone,
    address: receiver.address,
    dueDate,
    orderDate,
    sortWeight: parseDayTime(dueDate),
    createdAt,
    finishedAt: 0,
    time: formatRecordTime(createdAt)
  }

  current.tasks.unshift(task)
  persist()
  return { ok: true, task: decorateTask(task) }
}

/**
 * 生产报工：按 BOM 扣减物料库存，每种物料写一条「领料」出库记录
 * 备注统一为「生产任务领用 · 版本 × 台数」，日志页可逐条核对少了哪些料
 * 物料不足时整单拒绝，避免出现「报了一半」的中间状态
 * @param {string} taskId
 * @param {number} qty 本次完工台数
 */
function reportTask(taskId, qty) {
  const current = loadState()
  const task = getRawTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }
  if (task.status === 'done') return { ok: false, message: '该任务已完成' }

  const amount = Math.floor(Number(qty) || 0)
  if (amount <= 0) return { ok: false, message: '请输入报工数量' }
  if (task.doneQty + amount > task.planQty) {
    return { ok: false, message: `超出计划数量，最多还能报 ${task.planQty - task.doneQty} 台` }
  }

  const bom = getRawBom(task.bomId)
  if (!bom) return { ok: false, message: '该任务的 BOM 已不存在' }
  if (!bom.items.length) return { ok: false, message: '该 BOM 还没有物料，请先维护' }

  // 先整体校验，缺料就整单拒绝
  const lines = []
  for (let i = 0; i < bom.items.length; i += 1) {
    const line = bom.items[i]
    const goods = current.goods.find((item) => item.id === line.goodsId)
    if (!goods) return { ok: false, message: 'BOM 中有已删除的物料，请先维护 BOM' }

    const need = (Number(line.qty) || 0) * amount
    if (need <= 0) continue
    if (need > goods.stock) {
      return {
        ok: false,
        message: `「${goods.title}」库存不足，还差 ${need - goods.stock}${goods.unit}`
      }
    }
    lines.push({ goods, need })
  }

  if (!lines.length) return { ok: false, message: 'BOM 单台用量为 0，请先维护' }

  lines.forEach((line) => {
    line.goods.stock -= line.need
  })

  task.doneQty += amount
  if (task.doneQty >= task.planQty) {
    task.status = 'done'
    task.finishedAt = Date.now()
  }

  const createdAt = Date.now()
  const todayCount = current.records.filter(
    (item) =>
      item.type === 'out' && dayKey(new Date(item.createdAt)) === dayKey(new Date(createdAt))
  ).length

  // 每种物料单独一条领料记录，备注统一标记来源，日志里能一眼看出少了哪些料
  const pickRemark = `生产任务领用 · ${bom.version} × ${amount} 台`
  const records = lines.map((line, index) => ({
    id: makeRecordId('out', createdAt, todayCount + index + 1),
    type: 'out',
    typeText: '领料',
    goodsId: line.goods.id,
    title: line.goods.title,
    sku: line.goods.sku,
    spec: line.goods.spec,
    quantity: line.need,
    unit: line.goods.unit,
    operator: task.operator,
    location: line.goods.location || '',
    remark: pickRemark,
    taskId: task.id,
    taskVersion: bom.version,
    taskQty: amount,
    createdAt,
    time: formatRecordTime(createdAt)
  }))

  current.records = records.concat(current.records)
  trimRecords(current)
  persist()

  return {
    ok: true,
    task: decorateTask(task),
    // 兼容旧调用：record 为第一条领料记录
    record: Object.assign({}, records[0]),
    records: records.map((item) => Object.assign({}, item)),
    recordCount: records.length,
    lines: lines.map((line) => ({
      title: line.goods.title,
      unit: line.goods.unit,
      qty: line.need
    }))
  }
}

/**
 * 删除生产任务
 * 只移除任务本身：已报工产生的领料记录与库存扣减属于历史流水，不回滚。
 * @param {string} taskId
 */
function removeTask(taskId) {
  const current = loadState()
  const index = current.tasks.findIndex((item) => item.id === taskId)
  if (index === -1) return { ok: false, message: '任务不存在' }

  const task = current.tasks[index]
  const recordCount = current.records.filter((item) => item.taskId === taskId).length

  current.tasks.splice(index, 1)
  persist()

  return {
    ok: true,
    task: Object.assign({}, task),
    doneQty: task.doneQty || 0,
    recordCount,
    message: recordCount ? `已删除，保留 ${recordCount} 条领料记录` : '任务已删除'
  }
}

/** 手动结束任务（未报工部分不扣料） */
function finishTask(taskId) {
  const task = getRawTask(taskId)
  if (!task) return { ok: false, message: '任务不存在' }
  if (task.status === 'done') return { ok: false, message: '任务已完成' }

  task.status = 'done'
  task.finishedAt = Date.now()
  persist()
  return { ok: true, task: decorateTask(task) }
}

module.exports = {
  FALLBACK_CATEGORY,
  STOCK_STATUS_TEXT,
  // 金额格式化（页面做预览时用）
  formatMoney,
  parseMoney,
  // 数据变化订阅（跨页同步）
  subscribe,
  notifyChange,
  reload,
  // 分类
  listCategories,
  categoryNames,
  getDefaultCategory,
  addCategory,
  renameCategory,
  removeCategory,
  listGoods,
  getGoods,
  findGoodsByCode,
  saveGoods,
  removeGoods,
  listRecords,
  listRecentOps,
  isPickRecord,
  addRecord,
  getOverview,
  getUser,
  setUser,
  clearUser,
  resetDemoData,
  formatRecordTime,
  formatDayLabel,
  // BOM
  listBoms,
  getBom,
  saveBom,
  removeBom,
  saveBomItem,
  removeBomItem,
  importBomText,
  // 齐套分析
  analyzeTask,
  // 生产任务
  listTasks,
  getTaskSortMode,
  setTaskSortMode,
  setTaskPriority,
  taskAmountOf,
  getTaskAnalysis,
  getCurrentTask,
  getTaskBoard,
  moveTask,
  resetTaskOrder,
  setTaskDueDate,
  setTaskOrderDate,
  updateTaskPrice,
  updateTaskReceiver,
  dueInfoOf,
  saveTask,
  reportTask,
  finishTask,
  removeTask
}
