use ksni::menu::StandardItem;
use ksni::{Icon, MenuItem, ToolTip, TrayMethods};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex;

#[derive(Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrayState {
    color: String,
    tooltip: String,
    open_text: String,
    apply_text: String,
    apply_enabled: bool,
    check_text: String,
    quit_text: String,
}

#[derive(Default)]
pub struct LinuxTray(Mutex<Option<ksni::Handle<HflTray>>>);

pub struct HflTray {
    app: AppHandle,
    state: TrayState,
    icons: [Icon; 3],
}

fn decode(bytes: &[u8]) -> Icon {
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().expect("tray png");
    let mut buf = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buf).expect("tray png");
    let channels = info.color_type.samples();
    let mut data = Vec::with_capacity((info.width * info.height * 4) as usize);
    for px in buf[..info.buffer_size()].chunks_exact(channels) {
        let a = if channels == 4 { px[3] } else { 255 };
        data.extend_from_slice(&[a, px[0], px[1], px[2]]);
    }
    Icon { width: info.width as i32, height: info.height as i32, data }
}

fn icons() -> [Icon; 3] {
    [
        decode(include_bytes!("../../public/tray/green.png")),
        decode(include_bytes!("../../public/tray/yellow.png")),
        decode(include_bytes!("../../public/tray/red.png")),
    ]
}

impl ksni::Tray for HflTray {
    fn id(&self) -> String {
        "hfenceline".into()
    }

    fn title(&self) -> String {
        "hFenceline".into()
    }

    fn activate(&mut self, _x: i32, _y: i32) {
        crate::show_main(&self.app);
    }

    fn icon_pixmap(&self) -> Vec<Icon> {
        let i = match self.state.color.as_str() {
            "yellow" => 1,
            "red" => 2,
            _ => 0,
        };
        vec![self.icons[i].clone()]
    }

    fn tool_tip(&self) -> ToolTip {
        ToolTip {
            title: "hFenceline".into(),
            description: self.state.tooltip.clone(),
            ..Default::default()
        }
    }

    fn menu(&self) -> Vec<MenuItem<Self>> {
        let s = &self.state;
        let emit = |action: &'static str| -> Box<dyn Fn(&mut Self) + Send> {
            Box::new(move |t: &mut Self| {
                let _ = t.app.emit("tray-action", action);
            })
        };
        vec![
            StandardItem {
                label: s.open_text.clone(),
                activate: Box::new(|t: &mut Self| crate::show_main(&t.app)),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: s.apply_text.clone(),
                enabled: s.apply_enabled,
                activate: emit("apply-home-ip"),
                ..Default::default()
            }
            .into(),
            StandardItem {
                label: s.check_text.clone(),
                activate: emit("check"),
                ..Default::default()
            }
            .into(),
            MenuItem::Separator,
            StandardItem {
                label: s.quit_text.clone(),
                activate: Box::new(|t: &mut Self| {
                    let app = t.app.clone();
                    tauri::async_runtime::spawn(async move {
                        shutdown(&app).await;
                        app.exit(0);
                    });
                }),
                ..Default::default()
            }
            .into(),
        ]
    }
}

pub async fn linux_tray_update(app: AppHandle, tray: TrayState) -> Result<(), String> {
    let holder = app.state::<LinuxTray>();
    let mut guard = holder.0.lock().await;
    if let Some(handle) = guard.as_ref().filter(|h| !h.is_closed()) {
        handle.update(move |t| t.state = tray).await;
        return Ok(());
    }
    let handle = HflTray { app: app.clone(), state: tray, icons: icons() }
        .spawn()
        .await
        .map_err(|e| e.to_string())?;
    *guard = Some(handle);
    Ok(())
}

pub async fn shutdown(app: &AppHandle) {
    let handle = app.state::<LinuxTray>().0.lock().await.take();
    if let Some(h) = handle {
        h.shutdown().await;
    }
}
