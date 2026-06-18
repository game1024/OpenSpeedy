use gpui::{prelude::FluentBuilder as _, *};
use gpui_component::checkbox::Checkbox;
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::list::{List, ListDelegate, ListItem, ListState};
use gpui_component::IndexPath;
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

// ── Delegate ──────────────────────────────

pub struct ProcessListDelegate {
    pub all: Vec<ProcessInfo>,
    pub filtered: Vec<usize>,
    filter_text: String,
    loading: bool,
}

impl ProcessListDelegate {
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

impl ListDelegate for ProcessListDelegate {
    type Item = ListItem;

    fn items_count(&self, _section: usize, _cx: &App) -> usize { self.filtered.len() }

    fn set_selected_index(&mut self, _ix: Option<IndexPath>, _w: &mut Window, _cx: &mut Context<ListState<Self>>) {}

    fn loading(&self, _cx: &App) -> bool { self.loading }

    fn render_item(&mut self, ix: IndexPath, _w: &mut Window, cx: &mut Context<ListState<Self>>) -> Option<Self::Item> {
        let idx = self.filtered[ix.row];
        let p = &self.all[idx];
        let weak = cx.entity().downgrade();
        let (pid, name, arch, enabled, mem, title) = (
            p.pid, p.name.clone(), p.arch, p.enabled, p.memory_kb, p.window_title.clone(),
        );

        Some(ListItem::new(ElementId::Name(format!("r{}", ix.row).into()))
            .py(px(0.)).h(px(36.))
            .child(columns(
                div().w(px(50.)).child(
                    Checkbox::new(ElementId::Name(format!("cb-{}", pid).into())).checked(enabled)
                        .on_click(move |checked: &bool, _w, cx: &mut App| {
                            let _ = weak.update(cx, |state, cx| {
                                state.delegate_mut().all[idx].enabled = *checked; cx.notify();
                            });
                        }),
                ),
                div().w(px(280.)).overflow_hidden().child(
                    h_flex().gap_1().items_center()
                        .child(div().flex_shrink_0().w(px(14.)).h(px(14.)).flex().items_center().justify_center()
                            .rounded(px(3.)).bg(rgb(0x45475a)).text_xs().child(if title.is_some() { "🎮" } else { "⚙" }))
                        .child(h_flex().flex_1().gap_1().items_center().overflow_hidden()
                            .child(div().text_xs().text_color(rgb(0x0b1d3a)).truncate().child(name))
                            .when_some(title, |el, t| el.child(div().text_xs().text_color(rgb(0x6c7086)).truncate().child(t)))),
                ),
                div().w(px(50.)).text_xs().text_color(arch.color()).child(arch.label()),
                div().w(px(80.)).flex().justify_end().text_xs().text_color(rgb(0x6c7086)).child(format!("{}", pid)),
                div().w(px(100.)).flex().justify_end().text_xs().text_color(rgb(0x6c7086)).child(fmt_mem(mem)),
            ))
        )
    }
}

fn columns(
    check: impl IntoElement, proc: impl IntoElement, arch: impl IntoElement,
    pid: impl IntoElement, mem: impl IntoElement,
) -> Div {
    h_flex().w_full().items_center()
        .child(check).child(proc).child(arch).child(pid).child(mem)
}

// ── 主视图 ────────────────────────────────

pub struct ProcessListView {
    list: Entity<ListState<ProcessListDelegate>>,
    search: Entity<InputState>,
}

impl ProcessListView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let list = cx.new(|cx| ListState::new(ProcessListDelegate::new(), window, cx));
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("搜索进程名或窗口标题..."));
        // 异步加载进程
        cx.spawn(async move |this: WeakEntity<Self>, cx: &mut AsyncApp| {
            let mut procs = crate::process_enumerator::enumerate_processes();
            procs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
            let _ = this.update(cx, |this, cx| {
                let len = procs.len();
                this.list.update(cx, |state, cx| {
                    let d = state.delegate_mut();
                    d.loading = false;
                    d.all = procs;
                    d.filtered = (0..len).collect();
                    cx.notify();
                });
                cx.notify();
            });
        }).detach();
        Self { list, search }
    }

    fn apply_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let query = self.search.read(cx).value().to_string();
        self.list.update(cx, |state, cx| {
            state.delegate_mut().filter_text = query;
            state.delegate_mut().apply_filter();
            cx.notify();
        });
    }
}

impl Render for ProcessListView {
    fn render(&mut self, w: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        cx.subscribe_in(&self.search, w, |this, _state, event, w, cx| {
            if matches!(event, InputEvent::Change) { this.apply_search(w, cx); }
        });

        v_flex().size_full().bg(cx.theme().background)
            .child(h_flex().px_3().py_2().justify_center().child(
                div().text_size(px(24.)).font_weight(FontWeight::BOLD).text_color(rgb(0x000000)).child("进程管理器"),
            ))
            .child(div().h(px(40.)))
            .child(div().px_3().py_2().child(
                Input::new(&self.search).cleanable(true).h(px(40.)).prefix(div().text_xs().text_color(rgb(0x6c7086)).child("🔍")),
            ))
            .child(div().h(px(1.)).w_full().bg(cx.theme().border))
            .child(
                columns(
                    div().w(px(50.)).text_sm().text_color(rgb(0x9399b2)).child("加速"),
                    div().w(px(280.)).text_sm().text_color(rgb(0x9399b2)).child("进程"),
                    div().w(px(50.)).text_xs().text_color(rgb(0x9399b2)).child("架构"),
                    div().w(px(80.)).flex().justify_end().text_xs().text_color(rgb(0x9399b2)).child("PID"),
                    div().w(px(100.)).flex().justify_end().text_xs().text_color(rgb(0x9399b2)).child("内存"),
                ).px_3().py_2().bg(cx.theme().muted)
            )
            .child(div().flex_1().child(List::new(&self.list)))
            .children(Root::render_dialog_layer(w, cx))
            .children(Root::render_sheet_layer(w, cx))
            .children(Root::render_notification_layer(w, cx))
    }
}
