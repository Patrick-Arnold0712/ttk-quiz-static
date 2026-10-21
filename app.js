(() => {
  const $ = (id) => document.getElementById(id)
  const ATTEMPTS_KEY = 'ttk.static.attempts.v1'
  const SUBJECT_KEY = 'ttk.static.subject.v1'

  const state = {
    subjects: [],
    subjectId: null,
    tree: { chapters: [], kps: [] },
    chapterById: new Map(),
    kpById: new Map(),
    questions: [],
    filtered: [],
    idx: 0,
    selected: '',
    revealed: false,
    wrongOnly: false,
    attempts: loadAttempts(),
  }

  function loadAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || '{}') || {} }
    catch { return {} }
  }
  function saveAttempts() {
    try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(state.attempts)) } catch {}
  }
  function saveSubject() {
    try { localStorage.setItem(SUBJECT_KEY, String(state.subjectId)) } catch {}
  }

  const letters = (s) => [...new Set(String(s || '').toUpperCase().match(/[A-H]/g) || [])].sort().join('')
  const normText = (s) => String(s || '').trim().toLowerCase().replace(/[\s，。；：！？、,.!?;:'"“”‘’（）()《》〈〉·—\-]/g, '')

  const TYPE = {
    single_choice: '单选', multi_choice: '多选', true_false: '判断',
    fill_blank: '填空', short_answer: '简答', essay: '论述',
  }
  const SOURCE = { real_exam: '真题', own_material: '教材', generated: '自出题', authority: '权威资料' }

  function isObjective(q) {
    return q.qtype === 'single_choice' || q.qtype === 'multi_choice' ||
      q.qtype === 'true_false' || q.qtype === 'fill_blank'
  }
  function rootOf(chapterId) {
    let c = state.chapterById.get(Number(chapterId))
    if (!c) return null
    while (c.parent_id != null) {
      const p = state.chapterById.get(Number(c.parent_id))
      if (!p) break
      c = p
    }
    return c.id
  }
  function lessonName(q) {
    return state.chapterById.get(Number(q.chapter_id))?.name || '未归章'
  }
  function kpName(q) {
    return state.kpById.get(Number(q.kp_id))?.name || ''
  }

  async function init() {
    bind()
    try {
      const subjects = await fetch('data/subjects.json', { cache: 'no-cache' }).then(r => r.json())
      state.subjects = subjects
      const sel = $('subject')
      sel.innerHTML = subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
      let saved = Number(localStorage.getItem(SUBJECT_KEY) || 0)
      const initial = subjects.some(s => s.id === saved) ? saved : subjects[0]?.id
      sel.value = String(initial)
      await loadSubject(initial)
    } catch (err) {
      $('title').textContent = '加载失败'
      $('desc').textContent = String(err.message || err)
    }
  }

  function bind() {
    $('subject').addEventListener('change', async (e) => {
      await loadSubject(Number(e.target.value))
    })
    $('chapter').addEventListener('change', () => {
      populateKpSelect()
      applyFilters(true)
    })
    $('kp').addEventListener('change', () => applyFilters(true))
    $('search').addEventListener('input', () => applyFilters(true))
    $('random').addEventListener('click', randomQuestion)
    $('wrongOnly').addEventListener('click', () => {
      state.wrongOnly = !state.wrongOnly
      $('wrongOnly').classList.toggle('on', state.wrongOnly)
      $('wrongOnly').textContent = state.wrongOnly ? '退出错题' : '只看错题'
      applyFilters(true)
    })
    $('prev').addEventListener('click', () => move(-1))
    $('next').addEventListener('click', () => move(1))
    $('submit').addEventListener('click', submit)
    $('reveal').addEventListener('click', () => reveal(false))
    $('reset').addEventListener('click', () => {
      if (!confirm('清空当前浏览器里的刷题进度？')) return
      state.attempts = {}
      saveAttempts()
      renderStats()
      renderQuestion()
    })
    $('fill').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
  }

  async function loadSubject(id) {
    state.subjectId = id
    saveSubject()
    const subject = state.subjects.find(s => s.id === id)
    $('title').textContent = subject?.name || '题题的库'
    $('desc').textContent = subject?.exam_name || subject?.description || '共享题库'
    const [tree, questions] = await Promise.all([
      fetch(`data/tree-${id}.json`, { cache: 'no-cache' }).then(r => r.json()),
      fetch(`data/questions-${id}.json`, { cache: 'no-cache' }).then(r => r.json()),
    ])
    state.tree = tree
    state.questions = questions
    state.chapterById = new Map(tree.chapters.map(c => [Number(c.id), c]))
    state.kpById = new Map(tree.kps.map(k => [Number(k.id), k]))
    state.filtered = []
    state.idx = 0
    state.selected = ''
    state.revealed = false
    state.wrongOnly = false
    $('wrongOnly').classList.remove('on')
    $('wrongOnly').textContent = '只看错题'
    $('search').value = ''

    const units = tree.chapters.filter(c => c.parent_id == null)
    $('chapter').innerHTML = '<option value="all">全部单元</option>' +
      units.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
    $('chapter').value = 'all'
    populateKpSelect()
    applyFilters(true)
  }

  function populateKpSelect() {
    const chosen = $('chapter').value
    const rows = state.tree.kps.filter(k => chosen === 'all' || rootOf(k.chapter_id) === Number(chosen))
    $('kp').innerHTML = '<option value="all">全部考点</option>' +
      rows.map(k => `<option value="${k.id}">${esc(k.name)}</option>`).join('')
    $('kp').value = 'all'
  }

  function applyFilters(reset) {
    const chapter = $('chapter').value
    const kp = $('kp').value
    const term = $('search').value.trim().toLowerCase()
    state.filtered = state.questions.filter(q => {
      if (state.wrongOnly) {
        const a = state.attempts[q.id]
        if (!a || a.ok !== false) return false
      }
      if (chapter !== 'all' && rootOf(q.chapter_id) !== Number(chapter)) return false
      if (kp !== 'all' && Number(q.kp_id) !== Number(kp)) return false
      if (term && !String(q.stem || '').toLowerCase().includes(term)) return false
      return true
    })
    if (reset) {
      state.idx = 0
      state.selected = ''
      state.revealed = false
    }
    if (state.idx >= state.filtered.length) state.idx = Math.max(0, state.filtered.length - 1)
    renderStats()
    renderQuestion()
  }

  function move(delta) {
    if (!state.filtered.length) return
    state.idx = (state.idx + delta + state.filtered.length) % state.filtered.length
    state.selected = ''
    state.revealed = false
    renderQuestion()
    $('card').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function randomQuestion() {
    if (!state.filtered.length) return
    state.idx = Math.floor(Math.random() * state.filtered.length)
    state.selected = ''
    state.revealed = false
    renderQuestion()
    $('card').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function renderStats() {
    const total = state.questions.length
    let attempted = 0, correct = 0, wrong = 0
    for (const q of state.questions) {
      const a = state.attempts[q.id]
      if (!a) continue
      attempted++
      if (a.ok) correct++
      else wrong++
    }
    const items = [
      ['题库', total], ['已做', attempted], ['答对', correct], ['错题', wrong],
    ]
    $('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('')
  }

  function renderQuestion() {
    const q = state.filtered[state.idx]
    const card = $('card')
    const empty = $('empty')
    if (!q) {
      card.hidden = true
      empty.hidden = false
      return
    }
    card.hidden = false
    empty.hidden = true

    $('position').textContent = `${state.idx + 1} / ${state.filtered.length}`
    $('qtype').textContent = TYPE[q.qtype] || q.qtype
    $('lesson').textContent = lessonName(q)
    const kn = kpName(q)
    $('kpname').textContent = kn && kn !== lessonName(q) ? kn : ''
    $('kpname').hidden = !($('kpname').textContent)
    $('source').textContent = SOURCE[q.source_type] || q.source_type || ''
    $('source').hidden = !$('source').textContent
    $('stem').textContent = q.stem || ''

    const isFill = q.qtype === 'fill_blank'
    $('fillWrap').hidden = !isFill
    $('fill').value = ''

    renderOptions(q)
    $('feedback').hidden = true
    $('feedback').className = 'feedback'
    $('explain').hidden = true
    $('explain').textContent = ''

    const subjective = !isObjective(q)
    $('submit').disabled = subjective
    $('submit').textContent = subjective ? '主观题' : '提交'
    $('reveal').textContent = subjective ? '看参考答案' : '看答案'
    if (subjective) {
      $('feedback').hidden = false
      $('feedback').className = 'feedback warn'
      $('feedback').textContent = '主观题不自动判分：先自己在心里作答，再看参考答案对照。'
    }
  }

  function renderOptions(q) {
    const box = $('options')
    box.innerHTML = ''
    if (!q.options?.length) return
    for (const opt of q.options) {
      const el = document.createElement('div')
      el.className = 'opt'
      el.dataset.key = opt.key
      el.innerHTML = `<span class="key">${esc(opt.key)}</span><span>${esc(opt.text)}</span>`
      el.addEventListener('click', () => pick(opt.key))
      box.appendChild(el)
    }
    paintOptions(q)
  }

  function paintOptions(q) {
    const answer = letters(q.answer)
    for (const el of $('options').children) {
      const key = el.dataset.key
      el.classList.toggle('selected', !state.revealed && state.selected.includes(key))
      if (state.revealed) {
        el.classList.toggle('right', answer.includes(key))
        el.classList.toggle('wrong', state.selected.includes(key) && !answer.includes(key))
      }
    }
  }

  function pick(key) {
    const q = state.filtered[state.idx]
    if (!q || state.revealed) return
    if (q.qtype === 'multi_choice') {
      const s = new Set(state.selected.split(''))
      s.has(key) ? s.delete(key) : s.add(key)
      state.selected = [...s].sort().join('')
    } else {
      state.selected = key
    }
    paintOptions(q)
  }

  function submit() {
    const q = state.filtered[state.idx]
    if (!q || !isObjective(q) || state.revealed) return
    const user = q.qtype === 'fill_blank' ? $('fill').value : state.selected
    if (!String(user || '').trim()) return
    let ok = false
    if (q.qtype === 'fill_blank') ok = normText(user) === normText(q.answer)
    else ok = letters(user) === letters(q.answer) && letters(q.answer) !== ''
    state.attempts[q.id] = { ok, at: Date.now() }
    saveAttempts()
    reveal(true)
    renderStats()
  }

  function reveal(fromSubmit) {
    const q = state.filtered[state.idx]
    if (!q) return
    state.revealed = true
    paintOptions(q)
    const ans = answerText(q)
    const fb = $('feedback')
    fb.hidden = false
    if (!isObjective(q)) {
      fb.className = 'feedback warn'
      fb.textContent = '参考答案：' + ans
    } else if (fromSubmit) {
      const ok = !!state.attempts[q.id]?.ok
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad')
      fb.textContent = ok ? '答对了。' : '答错了，已记入本机错题本。'
      if (!ok) fb.textContent += ' 正确答案：' + ans
    } else {
      fb.className = 'feedback warn'
      fb.textContent = '正确答案：' + ans + '（看答案不计入作答）'
    }
    if (q.explanation) {
      $('explain').hidden = false
      $('explain').textContent = '解析：' + q.explanation
    }
    if (state.wrongOnly && state.attempts[q.id]?.ok) {
      // 错题答对后留在当前页，用户翻页时由筛选重新计算。
    }
  }

  function answerText(q) {
    if (q.qtype === 'fill_blank' || !q.options?.length) return String(q.answer || '见解析')
    const map = new Map(q.options.map(o => [o.key, o.text]))
    return letters(q.answer).split('').map(k => `${k}. ${map.get(k) || ''}`).join('  ') || String(q.answer || '')
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  init()
})()