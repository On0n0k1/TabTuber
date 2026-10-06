# [1.1.0](https://github.com/On0n0k1/TabTuber/compare/v1.0.0...v1.1.0) (2026-10-06)


### Features

* **tracker:** allow the delegate to be forced ([e183a93](https://github.com/On0n0k1/TabTuber/commit/e183a93077b5bb99446c1de6b0a779d8f2a83884))


### Performance Improvements

* **tracker:** decouple inference rate from camera rate ([e82c454](https://github.com/On0n0k1/TabTuber/commit/e82c4544a48c7eb06bd82490afcc3298607b2910))

# 1.0.0 (2026-10-06)


### Bug Fixes

* **audio:** default browser noise suppression to off ([ab7068f](https://github.com/On0n0k1/TabTuber/commit/ab7068f424af2d288ef9206a35c53e6092e5e239))
* **audio:** log microphone failures instead of swallowing them ([1eca633](https://github.com/On0n0k1/TabTuber/commit/1eca633c22637a44cd66db6e7d03ef2eb9eb16a6))
* **avatar:** default to a committed model ([5e284c6](https://github.com/On0n0k1/TabTuber/commit/5e284c68faa4a7e9ebb559175d99122e423c426f))
* **build:** reference the deploy token by its actual secret name ([5f42ff3](https://github.com/On0n0k1/TabTuber/commit/5f42ff3e26f01b7904eae0c5c44d4326a19bba9f))
* **capture:** give device changes their own channel ([576f0cf](https://github.com/On0n0k1/TabTuber/commit/576f0cf0628b4713626dbfc4f0e8bab241674f87))
* **capture:** report which camera is actually running ([a31e254](https://github.com/On0n0k1/TabTuber/commit/a31e2543d969afc6a4d24a77779b5ddec3255e87))
* **face:** drive both eyes with one clamped, smoothed rotation ([1a51777](https://github.com/On0n0k1/TabTuber/commit/1a517773922c869fe581c6f8a7397160dbb07778))
* **face:** make blinking open-or-shut with hysteresis ([e093085](https://github.com/On0n0k1/TabTuber/commit/e093085f72ad1273629c1abbb584e3a1282a3a68))
* **face:** resolve horizontal gaze per eye instead of averaging first ([0869076](https://github.com/On0n0k1/TabTuber/commit/0869076a484bd46ff9cabdb2023a2ca94decabfd))
* **face:** stretch the reported blink range onto a full close ([0a8dd1a](https://github.com/On0n0k1/TabTuber/commit/0a8dd1abdd4105ec0fac4c7951e867fb4f5c02c5))
* **filter:** smooth hand landmarks with their own profile ([0356da5](https://github.com/On0n0k1/TabTuber/commit/0356da544f86ecc9ea9763c8affa18ad35a82ddd))
* **render:** average the lookahead window instead of selecting from it ([39378b1](https://github.com/On0n0k1/TabTuber/commit/39378b17d8dff6a1d7f3476022c78037f944912b))
* **render:** interpolate the pose timestamp with the pose ([162fd0a](https://github.com/On0n0k1/TabTuber/commit/162fd0a7ef5e02a5789c0419b56b1f2d5dedc203))
* **render:** keep the avatar at the origin instead of offsetting it ([887f58a](https://github.com/On0n0k1/TabTuber/commit/887f58a3f5b62273e504940f103b5bf2a56ce30d))
* **render:** report absent finger bones separately from body bones ([3f44b74](https://github.com/On0n0k1/TabTuber/commit/3f44b743db0fd1dcbdb33baec66e1b303cd215c6))
* **render:** say why a model failed to load, and log it ([ab4a345](https://github.com/On0n0k1/TabTuber/commit/ab4a3451bd2acf4271e4f74dfa8bbf52caf2762d))
* **solver:** correct finger rest directions, roll and loss behaviour ([c6846ca](https://github.com/On0n0k1/TabTuber/commit/c6846caf7cdbfcd1712e3b6c9687c2d3149355ac))
* **solver:** exempt the thumb from the finger hinge constraint ([a7115e9](https://github.com/On0n0k1/TabTuber/commit/a7115e9b1640d9a081e0a8532164e0e17f3f4061))
* **solver:** extract forearm roll by swing-twist decomposition ([b0a84c8](https://github.com/On0n0k1/TabTuber/commit/b0a84c889d9adf01b0fdf0e19e302850e85e1dd1))
* **solver:** keep untracked legs under the body ([7d7e5be](https://github.com/On0n0k1/TabTuber/commit/7d7e5be3bec66d4d21608653eed8361ce0edee72))
* **solver:** mirror by swapping left and right landmarks ([6fca151](https://github.com/On0n0k1/TabTuber/commit/6fca1519f086861f83400975df24259221b4d638))
* **solver:** relax fingers once the hand itself is gone ([2c2b61c](https://github.com/On0n0k1/TabTuber/commit/2c2b61c750edfe26dbad3d9406423410e724aa10))
* **tracker:** survive inference failures and make face tracking opt-in ([694413b](https://github.com/On0n0k1/TabTuber/commit/694413b615f4dd38b5e146c61792d1c3e6834ca6))
* **ui:** collapse panel folders so controls below the fold are reachable ([fcb093f](https://github.com/On0n0k1/TabTuber/commit/fcb093fac9e9de99027666d55730a81d6380b3fd))
* **ui:** dismiss banners automatically and keep them clear of the panel ([2d66b5b](https://github.com/On0n0k1/TabTuber/commit/2d66b5bce397d42cacf74bab689ba8b8e9961faa))
* **ui:** hide the stick figure by default ([aa4e8d0](https://github.com/On0n0k1/TabTuber/commit/aa4e8d0ca4954eab5b35c6a3b8bc895b15271c0b))
* **ui:** let a banner timeout survive the caller that raised it ([5d0f0ae](https://github.com/On0n0k1/TabTuber/commit/5d0f0ae05c2d97b8b05ae52d9f5e8d31474e0c8b))
* **ui:** let a hidden banner actually be hidden ([fbf39ba](https://github.com/On0n0k1/TabTuber/commit/fbf39bad7246ae24261fcea4160708bdc8a08200))
* **ui:** move the camera preview to the bottom left ([21b2247](https://github.com/On0n0k1/TabTuber/commit/21b224785d4b31bb620cf36c0521d6db7e869894))
* **ui:** move the latency readout clear of the banner without :has ([412f6bd](https://github.com/On0n0k1/TabTuber/commit/412f6bd0a8dde2d07f55da6626b1dec50a4587ff))
* **ui:** reuse a panel folder instead of adding a second ([a6e28a7](https://github.com/On0n0k1/TabTuber/commit/a6e28a7a28cf4614decd57657578cf8626cb5e80))


### Features

* **audio:** add Silero VAD as a selectable speech detector ([9890068](https://github.com/On0n0k1/TabTuber/commit/989006808e8e87ca497424b749f859e83554aeaa))
* **audio:** blend visemes from a calibrated vowel space ([4f60c11](https://github.com/On0n0k1/TabTuber/commit/4f60c11ada735d2358d63e496c577eeea622343f))
* **audio:** drive the mouth from microphone amplitude ([3d3851c](https://github.com/On0n0k1/TabTuber/commit/3d3851cd35737f0c9486bac130b75bb286944b9f))
* **audio:** expose the browser's noise cancelling as live toggles ([ecd8949](https://github.com/On0n0k1/TabTuber/commit/ecd89492043f91dccbc3907b98399373fcb5c168))
* **audio:** let the camera drive the mouth while nothing is said ([73d8664](https://github.com/On0n0k1/TabTuber/commit/73d86648a29a297d874f5afcd6558a414cf4eb5d))
* **audio:** reject typing by duration rather than analysis ([c8bdb4b](https://github.com/On0n0k1/TabTuber/commit/c8bdb4b75864b86dca6df23ffb3f2a82a740512c))
* **audio:** relax the speech gate and allow disabling it ([8b23927](https://github.com/On0n0k1/TabTuber/commit/8b23927178dbcb2886d180d3230a4da11c10fb79))
* **avatar:** commit two sample avatars for the model picker ([736a072](https://github.com/On0n0k1/TabTuber/commit/736a0727127f757ce4b8a4e542061f5760c5321b))
* **avatar:** load and drive a VRM model ([7fd535e](https://github.com/On0n0k1/TabTuber/commit/7fd535e0f2b823ad5da1c1de5340fa9fdbb666ae))
* **capture:** webcam capture with device selection and error states ([57f9f5b](https://github.com/On0n0k1/TabTuber/commit/57f9f5b98db815d3f87b66235a47de3beb6efe46))
* define pose and avatar pose data contracts ([0e1c52a](https://github.com/On0n0k1/TabTuber/commit/0e1c52af88ed45547d201023439ae5fbb5d436ed))
* **face:** drive blink, gaze and expression from the camera ([7c8e453](https://github.com/On0n0k1/TabTuber/commit/7c8e45354c420d9e354945e8f7b8f25ded864e57))
* **face:** replace inferred emotion with manual toggles ([d69e8fb](https://github.com/On0n0k1/TabTuber/commit/d69e8fbb59af8dcfe04a5be3eec2afa11bc46a85))
* **filter:** one-euro filter bank with per-axis profiles ([49e82bd](https://github.com/On0n0k1/TabTuber/commit/49e82bd1e73bf3e207bff8a8f99806708a454507))
* **filter:** smooth hands harder when the palm turns edge-on ([9e9b7af](https://github.com/On0n0k1/TabTuber/commit/9e9b7afd163e48c05adb2eeb0bd2ff1ff706ef5c))
* **render:** decouple render loop with slerp interpolation ([9a90ced](https://github.com/On0n0k1/TabTuber/commit/9a90cedf7a8eb93035a8d2d8ad93ef110ecd3136))
* **render:** filter with the future as well as the past ([f4f3e41](https://github.com/On0n0k1/TabTuber/commit/f4f3e419334edb691918cb55a4452135c9177627))
* **render:** position-based stick figure from world landmarks ([a368499](https://github.com/On0n0k1/TabTuber/commit/a368499d91b83af43c79473f8638e74fd6e409de))
* **render:** rotation-driven debug rig ([a5cb971](https://github.com/On0n0k1/TabTuber/commit/a5cb97158b1101099aeee760e0c08c007132579d))
* **render:** transparent fullscreen canvas with dpr and resize handling ([4173640](https://github.com/On0n0k1/TabTuber/commit/41736402d878619b71636760204043392a4dadf4))
* **solver:** add idle motion and procedural blink ([afc86cd](https://github.com/On0n0k1/TabTuber/commit/afc86cd33bee535f058ebbd6431383506f132651))
* **solver:** add sitting and standing posture modes ([f7bd113](https://github.com/On0n0k1/TabTuber/commit/f7bd113a9b020cec87e4e10f999f375911f4dcd6))
* **solver:** add the 30 finger bones to the driven set ([57a347f](https://github.com/On0n0k1/TabTuber/commit/57a347fd763677cb5314a3fd55dbd70057207c42))
* **solver:** confine finger joints past the knuckle to one axis ([42d0a27](https://github.com/On0n0k1/TabTuber/commit/42d0a27217ce5ce11f71cf0f9a558aa66bcbc946))
* **solver:** correct hands the tracker reports rolled 180 degrees ([a5f0966](https://github.com/On0n0k1/TabTuber/commit/a5f0966fa3633cf497296a80d845e0209467f5d5))
* **solver:** degrade gracefully when limbs leave frame ([a6b6631](https://github.com/On0n0k1/TabTuber/commit/a6b6631c3bdbdcccf3f2bf6383dcf02f484dde67))
* **solver:** derive clamped lateral hip sway ([fc3a122](https://github.com/On0n0k1/TabTuber/commit/fc3a122cb73516add7a91fd9356060dcaea384f7))
* **solver:** derive hand orientation from the palm frame ([8a4de1f](https://github.com/On0n0k1/TabTuber/commit/8a4de1ff55b62cba86ae625fc2c91f7e4c19d190))
* **solver:** drive the finger bones from the hand landmarks ([63e9e67](https://github.com/On0n0k1/TabTuber/commit/63e9e67da61b8fe50ac65d7e1082b50671e8be29))
* **solver:** reference skeleton and landmark to rotation solver ([8202ecc](https://github.com/On0n0k1/TabTuber/commit/8202ecc899f5bea8ed06545256d3c3b387f804c1))
* **tracker:** add holistic backend alongside pose ([71f2e22](https://github.com/On0n0k1/TabTuber/commit/71f2e228fd687ec51824ac762f7780a70045a11b))
* **tracker:** make holistic the default backend ([4d4d386](https://github.com/On0n0k1/TabTuber/commit/4d4d386fe83eabba30d993015c442510d85ad4b3))
* **tracker:** pose landmarker detection loop ([3f851c9](https://github.com/On0n0k1/TabTuber/commit/3f851c9955f35522a3bf2d289633e71f96c83a90))
* **ui:** 2d landmark overlay ([f36e8a2](https://github.com/On0n0k1/TabTuber/commit/f36e8a228d9e709e3e5c6cd7ba84dcbc29c2ffa0))
* **ui:** add a performer toolbar for the controls used mid-stream ([2e209d6](https://github.com/On0n0k1/TabTuber/commit/2e209d62e770205ff5e749c1ffb0f3f719b644e7))
* **ui:** add a preview toggle that cannot stop tracking ([4a1539f](https://github.com/On0n0k1/TabTuber/commit/4a1539f8f42746a7f4e14729706067337aa9c967))
* **ui:** add reset and clear-saved-settings controls ([3f46aff](https://github.com/On0n0k1/TabTuber/commit/3f46aff7ef3f39bfd004a49c2622b1c412cca288))
* **ui:** always show the camera rate, colour it only when low ([e2f213d](https://github.com/On0n0k1/TabTuber/commit/e2f213d98df5b1a210a9fd9bebab14dad56171db))
* **ui:** debug panel with fps and camera diagnostics ([5cca392](https://github.com/On0n0k1/TabTuber/commit/5cca392786370f8dfbd505f0359b95c4a17cfa28))
* **ui:** draw real hand landmarks and flag flipped hands ([e017c95](https://github.com/On0n0k1/TabTuber/commit/e017c95e057c6cf0312e72b38374227e3cceb353))
* **ui:** explain the latency figures on hover ([2648585](https://github.com/On0n0k1/TabTuber/commit/264858583e1578e1007a76f8789fd6f99d30cda6))
* **ui:** list uploaded avatars in the picker ([8c138c0](https://github.com/On0n0k1/TabTuber/commit/8c138c03cdfde98ef0557bf5e8e6eff68a52ba21))
* **ui:** move first-run setup out of the debug panel into a sheet ([59eb529](https://github.com/On0n0k1/TabTuber/commit/59eb529dec8d887cde188eb7f9963b6b37e94320))
* **ui:** name a slow camera on the latency readout ([2b10495](https://github.com/On0n0k1/TabTuber/commit/2b10495b2ca92d0085e4be8c3df79b62bd24ee7e))
* **ui:** per-bone tracking weight readouts ([55629c9](https://github.com/On0n0k1/TabTuber/commit/55629c9b7b99bb18ee1c1eeaf7dd2867de741778))
* **ui:** put finger tracking on the toolbar ([947bb90](https://github.com/On0n0k1/TabTuber/commit/947bb9026a0267fdcea07aa37b29a812b5f117c4))
* **ui:** replace the native file input with a labelled upload button ([54da079](https://github.com/On0n0k1/TabTuber/commit/54da079d8984613430bd7b8c45de0aaf3200c25b))
* **ui:** report microphone state in the panel ([2905ece](https://github.com/On0n0k1/TabTuber/commit/2905ece1fcb033f68d748531009a9dbc5c8517b0))
* **ui:** report repeated banner raises to the console ([d089a46](https://github.com/On0n0k1/TabTuber/commit/d089a4602537528992dc38c996dacb7de89d5a45))
* **ui:** show end-to-end latency on the canvas ([ba00620](https://github.com/On0n0k1/TabTuber/commit/ba006204988767585b80e982f5a5a13cf9ce38de))


### Performance Improvements

* **render:** default lookahead to 0 frames ([790c399](https://github.com/On0n0k1/TabTuber/commit/790c399e7dc8e03689ee29b7caf286d5d4a2b2ca))
* **solver:** fit the palm frame to five rigid landmarks ([88e7dc5](https://github.com/On0n0k1/TabTuber/commit/88e7dc57b3b34d9d549ea04f9045e7595314b9a6))


### Reverts

* Revert "feat(audio): add Silero VAD as a selectable speech detector" ([75dc60f](https://github.com/On0n0k1/TabTuber/commit/75dc60f79498e0ace5ea1ff9fc67858bc0fd23d7))
* Revert "feat(audio): let the camera drive the mouth while nothing is said" ([63b6537](https://github.com/On0n0k1/TabTuber/commit/63b6537d42b6485e4bcfd2b13ace1988d5c2710c))
* **solver:** go back to the simple three-point palm frame ([5bfada2](https://github.com/On0n0k1/TabTuber/commit/5bfada2d7070441ff4d9e93e521f3f6778a1eed7))
