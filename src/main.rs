mod process_enumerator;
mod process_manager;

use gpui::*;
use gpui_component::Root;
use process_manager::ProcessListView;

fn main() {
    gpui_platform::application()
        .with_assets(gpui_component_assets::Assets)
        .run(|cx: &mut App| {
            gpui_component::init(cx);
            let _ = cx.open_window(
                WindowOptions {
                    titlebar: Some(TitlebarOptions {
                        title: Some("OpenSpeedy 进程管理器".into()),
                        ..Default::default()
                    }),
                    window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                        None,
                        size(px(1280.0), px(500.0)),
                        cx,
                    ))),
                    ..Default::default()
                },
                |window, cx| {
                    let view = cx.new(|cx| ProcessListView::new(window, cx));
                    cx.new(|cx| Root::new(view, window, cx))
                },
            );
        });
}
