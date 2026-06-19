use gpui::{prelude::FluentBuilder as _, *};
use gpui_component::checkbox::Checkbox;
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::slider::{Slider, SliderEvent, SliderState};
use gpui_component::table::{Column, DataTable, TableDelegate, TableState};
use gpui_component::{h_flex, v_flex, ActiveTheme as _, Root, StyledExt};

#[derive(Clone, Copy, PartialEq)]
pub enum Arch { X86, X64 }
impl Arch {
    fn label(&self) -> &'static str { match self { Arch::X86 => "x86", Arch::X64 => "x64" } }
    fn color(&self) -> impl Into<Hsla> { match self { Arch::X86 => rgb(0xf9e2af), Arch::X64 => rgb(0xa6e3a1) } }
}

pub struct ProcessInfo {
    pub pid: u32, pub name: String, pub arch: Arch,
    pub window_title: Option<String>, pub memory_kb: u64, pub enabled: bool,
}

fn fmt_mem(kb: u64) -> String {
    if kb >= 1024 * 1024 { format!("{:.1} GB", kb as f64 / (1024.0 * 1024.0)) }
    else if kb >= 1024 { format!("{:.1} MB", kb as f64 / 1024.0) }
    else { format!("{} KB", kb) }
}

const COL_ENABLE: usize = 0;
const COL_PROC: usize = 1;
const COL_ARCH: usize = 2;
const COL_PID: usize = 3;
const COL_MEM: usize = 4;

// ── TableDelegate ──────────────────────────

pub struct ProcessTableDelegate {
    pub all: Vec<ProcessInfo>,
    pub filtered: Vec<usize>,
    filter_text: String,
    loading: bool,
}

impl ProcessTableDelegate {
    pub fn new() -> Self {
        Self { all: vec![], filtered: vec![], filter_text: String::new(), loading: true }
    }
    fn apply_filter(&mut self) {
        let q = self.filter_text.to_lowercase();
        self.filtered = self.all.iter().enumerate()
            .filter(|(_, p)| q.is_empty()
                || p.name.to_lowercase().contains(&q)
                || p.window_title.as_ref().map(|t| t.to_lowercase().contains(&q)).unwrap_or(false))
            .map(|(i, _)| i).collect();
    }
}

impl TableDelegate for ProcessTableDelegate {
    fn columns_count(&self, _cx: &App) -> usize { 5 }
    fn rows_count(&self, _cx: &App) -> usize { self.filtered.len() }
    fn loading(&self, _cx: &App) -> bool { self.loading }

    fn column(&self, col: usize, _cx: &App) -> Column {
        match col {
            COL_ENABLE => Column::new("enable", "").width(px(50.)),
            COL_PROC => Column::new("proc", "").width(px(280.)),
            COL_ARCH => Column::new("arch", "").width(px(50.)),
            COL_PID => Column::new("pid", "").width(px(80.)),
            COL_MEM => Column::new("mem", "").width(px(100.)),
            _ => Column::new("", "").width(px(0.)),
        }
    }

    fn render_th(&mut self, col: usize, _w: &mut Window, _cx: &mut Context<TableState<Self>>) -> impl IntoElement {
        match col {
            COL_ENABLE => div().w_full().h(px(36.)).flex().items_center().justify_center().text_xs().text_color(rgb(0x9399b2)).child("加速"),
            COL_PROC => div().w_full().h(px(36.)).flex().items_center().text_xs().text_color(rgb(0x9399b2)).child("进程"),
            COL_ARCH => div().w_full().h(px(36.)).flex().items_center().justify_center().text_xs().text_color(rgb(0x9399b2)).child("架构"),
            COL_PID => div().w_full().h(px(36.)).flex().items_center().justify_end().text_xs().text_color(rgb(0x9399b2)).child("PID"),
            COL_MEM => div().w_full().h(px(36.)).flex().items_center().justify_end().text_xs().text_color(rgb(0x9399b2)).child("内存"),
            _ => div(),
        }
    }

    fn render_td(&mut self, row: usize, col: usize, _w: &mut Window, cx: &mut Context<TableState<Self>>) -> impl IntoElement {
        let idx = self.filtered[row];
        let p = &self.all[idx];
        let weak = cx.entity().downgrade();

        match col {
            COL_ENABLE => div().w_full().h(px(36.)).flex().items_center().justify_center().child(
                Checkbox::new(ElementId::Name(format!("cb-{}", p.pid).into())).checked(p.enabled)
                    .on_click(move |checked: &bool, _w, cx: &mut App| {
                        let _ = weak.update(cx, |state, cx| {
                            state.delegate_mut().all[idx].enabled = *checked; cx.notify();
                        });
                    }),
            ).into_any_element(),
            COL_PROC => {
                let icon = div().flex_shrink_0().w(px(14.)).h(px(14.)).flex().items_center().justify_center()
                    .rounded(px(3.)).bg(rgb(0x45475a)).text_xs()
                    .child(if p.window_title.is_some() { "🎮" } else { "⚙" });
                let title_el = h_flex().flex_1().gap_1().items_center().overflow_hidden()
                    .child(div().text_xs().text_color(rgb(0x0b1d3a)).truncate().child(p.name.clone()));
                let title_el = if let Some(t) = p.window_title.clone() {
                    title_el.child(div().text_xs().text_color(rgb(0x6c7086)).truncate().child(t))
                } else { title_el };
                h_flex().gap_1().items_center().h(px(36.)).overflow_hidden()
                    .child(icon).child(title_el).into_any_element()
            },
            COL_ARCH => div().h(px(36.)).flex().items_center().justify_center().text_xs().text_color(p.arch.color()).child(p.arch.label()).into_any_element(),
            COL_PID => div().h(px(36.)).flex().items_center().justify_end().text_xs().text_color(rgb(0x6c7086)).child(format!("{}", p.pid)).into_any_element(),
            COL_MEM => div().h(px(36.)).flex().items_center().justify_end().text_xs().text_color(rgb(0x6c7086)).child(fmt_mem(p.memory_kb)).into_any_element(),
            _ => div().into_any_element(),
        }
    }
}

// ── 主视图 ────────────────────────────────

pub struct ProcessListView {
    table: Entity<TableState<ProcessTableDelegate>>,
    search: Entity<InputState>,
    speed: Entity<SliderState>,
    current_speed: f64,
    _search_sub: Subscription,
    _slider_sub: Subscription,
}

impl ProcessListView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let table = cx.new(|cx| TableState::new(ProcessTableDelegate::new(), window, cx));
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("搜索进程名或窗口标题..."));

        let speed = cx.new(|_| SliderState::new().min(0.25).max(1000.0).step(0.25).default_value(1.0));
        let _slider_sub = cx.subscribe(&speed, |this: &mut Self, _s, e: &SliderEvent, cx| {
            if let SliderEvent::Change(v) = e { this.current_speed = v.start() as f64; cx.notify(); }
        });

        let _search_sub = cx.subscribe_in(&search, window, |this: &mut Self, state, event, _w, cx| {
            if matches!(event, InputEvent::Change) {
                let query = state.read(cx).value().to_string();
                this.table.update(cx, |state, cx| {
                    state.delegate_mut().filter_text = query;
                    state.delegate_mut().apply_filter();
                    cx.notify();
                });
            }
        });

        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let mut procs = crate::process_enumerator::enumerate_processes();
            procs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            let _ = this.update(cx, |this, cx| {
                let len = procs.len();
                this.table.update(cx, |state, cx| {
                    let d = state.delegate_mut();
                    d.loading = false;
                    d.all = procs;
                    d.filtered = (0..len).collect();
                    cx.notify();
                });
                cx.notify();
            });
        }).detach();
        Self { table, search, speed, current_speed: 1.0, _search_sub, _slider_sub }
    }
}

impl Render for ProcessListView {
    fn render(&mut self, w: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex().size_full().bg(cx.theme().background)
            .child(
                v_flex().px_4().py_3().gap_2().bg(rgb(0xe8f0fe))
                    .child(div().text_size(px(16.)).font_weight(FontWeight::SEMIBOLD).text_color(rgb(0x000000)).child("⚡ 变速控制"))
                    .child(div().w_full().flex().justify_center().child(
                        div().text_size(px(22.)).font_weight(FontWeight::BOLD).text_color(rgb(0x1d4ed8)).child(format!("{:.2}x", self.current_speed)),
                    ))
                    .child(h_flex().gap_4().items_center()
                        .child(div().w(px(56.)).text_sm().text_color(rgb(0x9399b2)).child("0.25x"))
                        .child(div().flex_1().child(Slider::new(&self.speed).h(px(32.))))
                        .child(div().w(px(64.)).text_sm().text_color(rgb(0x9399b2)).child("1000x")),
                    )
                    .child(Input::new(&self.search).cleanable(true).h(px(40.)).bg(white()).prefix(div().text_xs().text_color(rgb(0x6c7086)).child("🔍"))),
            )
            .child(div().h(px(1.)).w_full().bg(cx.theme().border))
            .child(div().flex_1().child(DataTable::new(&self.table)))
            .children(Root::render_dialog_layer(w, cx))
            .children(Root::render_sheet_layer(w, cx))
            .children(Root::render_notification_layer(w, cx))
    }
}
