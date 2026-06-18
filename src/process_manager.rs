use gpui::{prelude::FluentBuilder as _, *};
use gpui_component::checkbox::Checkbox;
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::list::{List, ListDelegate, ListItem, ListState};
use gpui_component::{h_flex, v_flex, ActiveTheme as _, IndexPath, Root, StyledExt};

// ── 架构 ──────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
pub enum Arch {
    X86,
    X64,
}

impl Arch {
    fn label(&self) -> &'static str {
        match self {
            Arch::X86 => "x86",
            Arch::X64 => "x64",
        }
    }

    fn color(&self) -> impl Into<Hsla> {
        match self {
            Arch::X86 => rgb(0xf9e2af),
            Arch::X64 => rgb(0xa6e3a1),
        }
    }
}

// ── 进程数据 ──────────────────────────────

pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub arch: Arch,
    pub window_title: Option<String>,
    pub enabled: bool,
}

// ── Delegate ──────────────────────────────

pub struct ProcessListDelegate {
    pub processes: Vec<ProcessInfo>,
    filter_text: String,
    filtered: Vec<usize>,
}

impl ProcessListDelegate {
    pub fn new() -> Self {
        let mut processes = crate::process_enumerator::enumerate_processes();
        processes.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        let filtered: Vec<usize> = (0..processes.len()).collect();
        Self { processes, filter_text: String::new(), filtered }
    }

    pub fn apply_filter(&mut self, text: &str) {
        self.filter_text = text.to_lowercase();
        self.filtered = self
            .processes
            .iter()
            .enumerate()
            .filter(|(_, p)| {
                self.filter_text.is_empty()
                    || p.name.to_lowercase().contains(&self.filter_text)
                    || p.window_title.as_ref().map(|t| t.to_lowercase().contains(&self.filter_text)).unwrap_or(false)
            })
            .map(|(i, _)| i)
            .collect();
    }
}

impl ListDelegate for ProcessListDelegate {
    type Item = ListItem;

    fn items_count(&self, _section: usize, _cx: &App) -> usize {
        self.filtered.len()
    }

    fn set_selected_index(
        &mut self,
        _ix: Option<IndexPath>,
        _window: &mut Window,
        _cx: &mut Context<ListState<Self>>,
    ) {
    }

    fn render_item(
        &mut self,
        ix: IndexPath,
        _window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Option<Self::Item> {
        let idx = self.filtered[ix.row];
        let proc = &self.processes[idx];
        let weak = cx.entity().downgrade();
        let pid = proc.pid;
        let name = proc.name.clone();
        let arch = proc.arch;
        let enabled = proc.enabled;
        let window_title = proc.window_title.clone();

        let row = ListItem::new(ElementId::Name(format!("row-{}", ix.row).into()))
            .py(px(0.))
            .m(px(0.))
            .h(px(40.))
            .child(
                h_flex()
                    .gap_2()
                    .px_3()
                    .h(px(40.))
                    .items_center()
                    .w_full()
                    // checkbox
                    .child(
                        div().w(px(35.)).child(
                            Checkbox::new(ElementId::Name(format!("cb-{}", pid).into()))
                                .checked(enabled)
                                .on_click(move |checked: &bool, _window, cx: &mut App| {
                                    let _ = weak.update(cx, |state, cx| {
                                        state.delegate_mut().processes[idx].enabled = *checked;
                                        cx.notify();
                                    });
                                }),
                        ),
                    )
                    // 图标 + 进程名 + 窗口标题
                    .child(
                        h_flex()
                            .w(px(480.))
                            .gap_2()
                            .items_center()
                            .overflow_hidden()
                            .child(
                                div()
                                    .flex_shrink_0()
                                    .w(px(14.))
                                    .h(px(14.))
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .rounded(px(3.))
                                    .bg(rgb(0x45475a))
                                    .text_xs()
                                    .child(if window_title.is_some() { "🎮" } else { "⚙" }),
                            )
                            .child(
                                h_flex()
                                    .flex_1()
                                    .gap_1()
                                    .items_center()
                                    .overflow_hidden()
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(rgb(0xcdd6f4))
                                            .truncate()
                                            .child(name.clone()),
                                    )
                                    .when_some(window_title, |el, t| {
                                        el.child(
                                            div()
                                                .text_xs()
                                                .text_color(rgb(0x6c7086))
                                                .truncate()
                                                .child(t),
                                        )
                                    }),
                            ),
                    )
                    // 架构
                    .child(
                        div()
                            .w(px(30.))
                            .text_xs()
                            .text_color(arch.color())
                            .child(arch.label()),
                    )
                    // PID
                    .child(
                        div()
                            .w(px(80.))
                            .flex()
                            .justify_end()
                            .text_xs()
                            .text_color(rgb(0x6c7086))
                            .child(format!("{}", pid)),
                    )
                    .child(div().flex_1()),
            );

        Some(row)
    }
}

// ── 主视图 ────────────────────────────────

pub struct ProcessListView {
    list: Entity<ListState<ProcessListDelegate>>,
    search: Entity<InputState>,
}

impl ProcessListView {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let list = cx.new(|cx| ListState::new(ProcessListDelegate::new(), window, cx));
        let search = cx.new(|cx| {
            InputState::new(window, cx).placeholder("搜索进程名或窗口标题...")
        });
        Self { list, search }
    }

    fn apply_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let query = self.search.read(cx).value();
        self.list.update(cx, |state, cx| {
            state.delegate_mut().apply_filter(&query);
            cx.notify();
        });
    }
}

impl Render for ProcessListView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // 订阅搜索框变化
        cx.subscribe_in(&self.search, window, |this, _state, event, window, cx| {
            if matches!(event, InputEvent::Change) {
                this.apply_search(window, cx);
            }
        });

        v_flex()
            .size_full()
            .bg(rgb(0x1e1e2e))
            .child(
                // 标题栏
                h_flex()
                    .px_1()
                    .py_3()
                    .items_center()
                    .justify_center()
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(
                        div()
                            .text_size(px(24.))
                            .font_bold()
                            .text_color(rgb(0x89b4fa))
                            .child("OpenSpeedy 进程管理器"),
                    ),
            )
            .child(
                // 搜索框
                div()
                    .px_3()
                    .py_2()
                    .child(Input::new(&self.search).cleanable(true).bg(rgb(0x313244)).prefix(
                        div().text_xs().text_color(rgb(0x6c7086)).child("🔍"),
                    )),
            )
            .child(
                // 表头
                h_flex()
                    .px_3()
                    .py_0()
                    .gap_2()
                    .bg(rgb(0x313244))
                    .child(div().w(px(35.)).text_sm().text_color(rgb(0x9399b2)).child("加速"))
                    .child(div().w(px(480.)).text_sm().text_color(rgb(0x9399b2)).child("进程"))
                    .child(div().w(px(30.)).text_xs().text_color(rgb(0x9399b2)).child("架构"))
                    .child(div().w(px(80.)).flex().justify_end().text_xs().text_color(rgb(0x9399b2)).child("PID"))
                    .child(div().flex_1()),
            )
            .child(
                // 进程列表主体
                div().flex_1().child(List::new(&self.list)),
            )
            .children(Root::render_dialog_layer(window, cx))
            .children(Root::render_sheet_layer(window, cx))
            .children(Root::render_notification_layer(window, cx))
    }
}
