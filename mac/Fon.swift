// Fon — Mac uygulaması. Web stüdyosunu WKWebView içinde çalıştırır;
// "Mac'e uygula" ile tasarımı her ekranın gerçek çözünürlüğünde masaüstü arkaplanı yapar.
import Cocoa
import WebKit
import UniformTypeIdentifiers

// Uygulama paketi içindeki web dosyalarını fon://app/ adresinden sunar (kalıcı localStorage için sabit köken)
final class BundleScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist)); return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let res = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                  headerFields: ["Content-Type": mime, "Content-Length": "\(data.count)"])!
        task.didReceive(res); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, NSWindowDelegate, NSSharingServiceDelegate {
    var window: NSWindow!
    var web: WKWebView!

    func applicationDidFinishLaunching(_ note: Notification) {
        let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(BundleScheme(root: webRoot), forURLScheme: "fon")
        cfg.userContentController.add(self, name: "fon")
        cfg.userContentController.addUserScript(WKUserScript(source: "window.FonNative = \(nativeInfoJSON());",
                                                             injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")

        web = WKWebView(frame: .zero, configuration: cfg)
        web.uiDelegate = self
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Fon"
        window.minSize = NSSize(width: 980, height: 640)
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("FonMain")
        if !window.setFrameUsingName("FonMain") { window.center() }
        window.makeKeyAndOrderFront(nil)

        web.load(URLRequest(url: URL(string: "fon://app/index.html")!))
        buildMenu()

        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            guard let self else { return }
            self.web.evaluateJavaScript("window.FonApp && FonApp.setScreens(\(self.screensJSON()))")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

    // ---------- ekran bilgisi
    func screensJSON() -> String {
        let list: [[String: Any]] = NSScreen.screens.enumerated().map { i, s in
            let scale = s.backingScaleFactor
            let id = (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
            let builtin = CGDisplayIsBuiltin(id) != 0
            return ["index": i,
                    "name": s.localizedName,
                    "w": Int((s.frame.width * scale).rounded()),
                    "h": Int((s.frame.height * scale).rounded()),
                    "builtin": builtin,
                    "notch": s.safeAreaInsets.top > 0,
                    "main": s == NSScreen.main]
        }
        let data = try! JSONSerialization.data(withJSONObject: list)
        return String(data: data, encoding: .utf8)!
    }
    func nativeInfoJSON() -> String { "{\"screens\": \(screensJSON()), \"platform\": \"mac\"}" }

    // ---------- köprü
    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "apply": apply(body["images"] as? [[String: Any]] ?? [])
        case "save": save(body["files"] as? [[String: Any]] ?? [])
        case "phone": sendToPhone(mode: body["mode"] as? String ?? "airdrop", name: body["name"] as? String ?? "Fon-iPhone.png", data: body["data"] as? String ?? "")
        default: break
        }
    }

    func decode(_ dataURL: String) -> Data? {
        guard let comma = dataURL.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...]))
    }

    func reply(_ ok: Bool, _ msg: String) {
        let json = String(data: try! JSONSerialization.data(withJSONObject: ["ok": ok, "message": msg]), encoding: .utf8)!
        web.evaluateJavaScript("FonApp.onNative(\(json))")
    }

    func apply(_ images: [[String: Any]]) {
        let fm = FileManager.default
        let dir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Fon/Arkaplanlar", isDirectory: true)
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            let screens = NSScreen.screens
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            var done = 0
            for img in images {
                guard let idx = img["screen"] as? Int, idx < screens.count,
                      let str = img["data"] as? String, let data = decode(str) else { continue }
                // macOS aynı yoldaki dosyayı önbellekten gösterir: her uygulamada yeni ad, eskileri sil
                let prefix = "fon-ekran\(idx)-"
                for old in (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
                where old.lastPathComponent.hasPrefix(prefix) { try? fm.removeItem(at: old) }
                let url = dir.appendingPathComponent("\(prefix)\(stamp).png")
                try data.write(to: url)
                try NSWorkspace.shared.setDesktopImageURL(url, for: screens[idx], options: [
                    .imageScaling: NSImageScaling.scaleProportionallyUpOrDown.rawValue,
                    .allowClipping: true,
                ])
                done += 1
            }
            reply(done > 0, done > 1 ? "\(done) ekrana uygulandı" : done == 1 ? "Masaüstüne uygulandı" : "Uygulanacak ekran bulunamadı")
        } catch {
            reply(false, "Uygulanamadı: \(error.localizedDescription)")
        }
    }

    // Apple, Mac'ten iPhone duvar kağıdını doğrudan ayarlamaya izin vermiyor; en kısa iki yol AirDrop ve iCloud Drive
    func sendToPhone(mode: String, name: String, data str: String) {
        guard let data = decode(str) else { reply(false, "Görsel hazırlanamadı"); return }
        let fm = FileManager.default
        do {
            if mode == "icloud" {
                let drive = fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
                guard fm.fileExists(atPath: drive.path) else {
                    reply(false, "iCloud Drive bu Mac'te kapalı. Sistem Ayarları → Apple Hesabı → iCloud → iCloud Drive'ı aç ya da AirDrop'u kullan.")
                    return
                }
                let dir = drive.appendingPathComponent("Fon", isDirectory: true)
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                try data.write(to: dir.appendingPathComponent("Fon-iPhone.png"), options: .atomic)
                reply(true, "iCloud Drive/Fon/Fon-iPhone.png güncellendi")
                return
            }
            let tmp = fm.temporaryDirectory.appendingPathComponent("Fon-AirDrop", isDirectory: true)
            try? fm.removeItem(at: tmp)
            try fm.createDirectory(at: tmp, withIntermediateDirectories: true)
            let url = tmp.appendingPathComponent(name)
            try data.write(to: url)
            guard let svc = NSSharingService(named: .sendViaAirDrop), svc.canPerform(withItems: [url]) else {
                reply(false, "AirDrop kullanılamıyor (Wi-Fi ve Bluetooth açık mı?)"); return
            }
            svc.delegate = self
            svc.perform(withItems: [url])
        } catch {
            reply(false, "Gönderilemedi: \(error.localizedDescription)")
        }
    }
    func sharingService(_ s: NSSharingService, didShareItems items: [Any]) { reply(true, "iPhone'a gönderildi. Telefonda Paylaş → Duvar Kağıdı Olarak Kullan.") }
    func sharingService(_ s: NSSharingService, didFailToShareItems items: [Any], error: Error) {
        let cancelled = (error as NSError).code == NSUserCancelledError
        reply(false, cancelled ? "AirDrop iptal edildi" : "AirDrop başarısız: \(error.localizedDescription)")
    }
    func sharingService(_ s: NSSharingService, sourceWindowForShareItems items: [Any], sharingContentScope: UnsafeMutablePointer<NSSharingService.SharingContentScope>) -> NSWindow? { window }

    func save(_ files: [[String: Any]]) {
        let items: [(String, Data)] = files.compactMap { f in
            guard let name = f["name"] as? String, let s = f["data"] as? String, let d = decode(s) else { return nil }
            return (name, d)
        }
        guard !items.isEmpty else { return }
        if items.count == 1 {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = items[0].0
            panel.beginSheetModal(for: window) { r in
                guard r == .OK, let url = panel.url else { return }
                do { try items[0].1.write(to: url); self.reply(true, "Kaydedildi: \(url.lastPathComponent)") }
                catch { self.reply(false, "Kaydedilemedi: \(error.localizedDescription)") }
            }
        } else {
            let panel = NSOpenPanel()
            panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.canCreateDirectories = true
            panel.prompt = "Buraya kaydet"; panel.message = "\(items.count) duvar kağıdı için klasör seç"
            panel.beginSheetModal(for: window) { r in
                guard r == .OK, let dir = panel.url else { return }
                do {
                    for (name, d) in items { try d.write(to: dir.appendingPathComponent(name)) }
                    self.reply(true, "\(items.count) dosya kaydedildi")
                } catch { self.reply(false, "Kaydedilemedi: \(error.localizedDescription)") }
            }
        }
    }

    // ---------- WKUIDelegate: dosya seçici ve JS diyalogları
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image]
        panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "Tamam"); a.addButton(withTitle: "Vazgeç")
        a.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    // ---------- menü (kopyala/yapıştır ve kısayollar için gerekli)
    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Fon Hakkında", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Fon'u Gizle", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Fon'dan Çık", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Düzen")
        edit.addItem(withTitle: "Geri Al", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Yinele", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Kes", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Kopyala", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Yapıştır", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Tümünü Seç", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Pencere")
        win.addItem(withTitle: "Küçült", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Kapat", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
