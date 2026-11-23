/**
 * Curated quick-pick lists for the icon picker, built from the bundled sets
 * (ids: `set:name`, plain = Tabler). Aimed at people labelling electronics,
 * games and small hardware who don't know icon names.
 */
export interface IconCollection {
  id: string;
  label: string;
  icons: string[];
}

export const ICON_COLLECTIONS: IconCollection[] = [
  {
    id: "electronics",
    label: "Electronics",
    icons: [
      "mdi:chip", "mdi:integrated-circuit-chip", "lucide:microchip", "cpu", "game-icons:processor", "mdi:memory", "lucide:memory-stick",
      "lucide:circuit-board", "game-icons:circuitry", "mdi:expansion-card", "mdi:resistor", "mdi:resistor-nodes", "circuit-resistor",
      "circuit-capacitor", "circuit-capacitor-polarized", "circuit-diode", "circuit-diode-zener", "circuit-inductor", "mdi:led-on", "circuit-bulb",
      "mdi:fuse", "circuit-switch-open", "circuit-pushbutton", "circuit-ground", "circuit-battery", "mdi:battery", "mdi:soldering-iron",
      "game-icons:soldering-iron", "mdi:raspberry-pi", "simple-icons:arduino", "simple-icons:raspberrypi", "simple-icons:espressif",
    ],
  },
  {
    id: "connectors",
    label: "Connectors & cables",
    icons: [
      "mdi:video-input-component", "mdi:video-input-svideo", "mdi:video-input-hdmi", "mdi:video-input-composite",
      "mdi:vga", "mdi:audio-input-rca", "mdi:audio-input-stereo-minijack", "mdi:audio-input-xlr", "mdi:serial-port", "mdi:usb",
      "mdi:ethernet", "mdi:hdmi-port", "mdi:cable-data", "lucide:cable", "plug-connected", "mdi:power-plug", "mdi:power-socket-eu",
      "game-icons:jack-plug", "lucide:plug-zap", "mdi:sd", "mdi:micro-sd", "mdi:sim", "mdi:antenna",
    ],
  },
  {
    id: "gaming",
    label: "Gaming",
    icons: [
      "mdi:gamepad-classic", "mdi:controller-classic", "mdi:gamepad-variant", "mdi:controller", "game-icons:retro-controller",
      "game-icons:console-controller", "game-icons:game-console", "game-icons:gamepad-cross", "game-icons:joystick", "device-gamepad",
      "device-gamepad-2", "mdi:nintendo-game-boy", "mdi:nintendo-switch", "mdi:nintendo-wii", "mdi:sony-playstation", "mdi:microsoft-xbox",
      "simple-icons:nintendo", "simple-icons:sega", "simple-icons:playstation", "simple-icons:atari", "simple-icons:commodore",
      "mdi:television-classic", "mdi:floppy", "mdi:cassette", "lucide:disc-3", "mdi:power-plug", "mdi:battery",
    ],
  },
  {
    id: "hardware",
    label: "Hardware",
    icons: [
      "mdi:screw-flat-top", "mdi:screw-round-top", "mdi:screw-machine-flat-top", "mdi:screw-machine-round-top", "mdi:screw-lag",
      "game-icons:screw", "mdi:nut", "game-icons:hexagonal-nut", "mdi:circle-double", "mdi:hexagon-outline", "game-icons:spring",
      "mdi:magnet", "mdi:screwdriver", "mdi:wrench", "mdi:hammer", "mdi:pliers", "lucide:drill", "lucide:ruler", "mdi:tape-measure",
      "mdi:toolbox", "mdi:package-variant", "mdi:archive", "box", "tool", "mdi:cog", "mdi:fan",
    ],
  },
];
