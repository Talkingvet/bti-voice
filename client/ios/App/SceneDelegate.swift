//
//  SceneDelegate.swift
//  App
//
//  Created by Danny Roche on 8/19/26.
//

import Foundation
import UIKit
import Capacitor
 
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
 
    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        // The storyboard (set in Info.plist) loads Capacitor's bridge view controller.
    }
 
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }
 
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared,
            continue: userActivity, restorationHandler: { _ in })
    }
}

