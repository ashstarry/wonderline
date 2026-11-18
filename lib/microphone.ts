/** Device discovery never starts capture or opens the system-default microphone. */
export type MicrophoneDevice = {
  deviceId: string;
  label: string;
  groupId: string;
  /** Positive recognition of a named built-in/computer microphone, not !isPhone. */
  isComputer: boolean;
  /** Best-effort label hint only; a renamed iPhone may not contain these words. */
  isPhone: boolean;
};

export type ResolvedMicrophone = MicrophoneDevice & { isSystem: boolean };

const PHONE = /iphone|ipad|continuity|连续互通|連續互通|接续互通/i;
const COMPUTER = /macbook|imac|studio display|built[ -]?in|internal microphone|内置|内建|內置|內建/i;
const ALIAS_LABEL = /^(?:default|communications|默认|預設|通信|通讯)(?:\s*[-:（(]|$)/i;

export async function listMicrophones(): Promise<MicrophoneDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    throw new Error('这个浏览器暂时不能列出麦克风，请在支持麦克风选择的浏览器中打开。');
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const seen = new Set<string>();
  return devices.filter(device => {
    if (device.kind !== 'audioinput' || !device.deviceId || ['default', 'communications'].includes(device.deviceId) || ALIAS_LABEL.test(device.label) || seen.has(device.deviceId)) return false;
    seen.add(device.deviceId);
    return true;
  }).map(device => {
    const label = device.label.trim();
    const isPhone = PHONE.test(label);
    return { deviceId: device.deviceId, label, groupId: device.groupId, isPhone, isComputer: !isPhone && COMPUTER.test(label) };
  });
}

export async function resolveMicrophone(deviceId = 'system'): Promise<ResolvedMicrophone> {
  if (deviceId === 'system') {
    // The browser's default alias follows its current default input. Do not turn
    // this into a physical ID: the next recording must follow a changed default.
    // First-use browsers may hide both names and IDs until capture is allowed.
    let alias: MediaDeviceInfo | undefined;
    try {
      const devices = await navigator.mediaDevices?.enumerateDevices?.();
      alias = devices?.find(device => device.kind === 'audioinput' && device.deviceId === 'default');
    } catch { /* Discovery is optional for ordinary default-device capture. */ }
    return {
      deviceId: alias?.deviceId || '', label: alias?.label || '系统默认麦克风',
      groupId: alias?.groupId || '', isComputer: false, isPhone: false, isSystem: true,
    };
  }
  const devices = await listMicrophones();
  if (deviceId === 'computer') {
    const candidates = devices.filter(device => device.isComputer);
    // Prefer the laptop's own microphone over a connected display microphone.
    const selected = candidates.find(device => /macbook/i.test(device.label)) || candidates[0];
    if (selected) return { ...selected, isSystem: false };
    if (!devices.some(device => device.label)) {
      throw new Error('浏览器还没显示麦克风名称。请在浏览器的网站权限或麦克风设置中允许访问并选择电脑麦克风，再刷新设备列表。');
    }
    throw new Error('还没找到能确认的电脑内置麦克风。请在麦克风列表中明确选择电脑上的设备，再开始说话。');
  }
  const selected = devices.find(device => device.deviceId === deviceId);
  if (!selected) throw new Error('之前选择的麦克风已不在设备列表中，请重新选择。没有切换到其他麦克风。');
  if (!selected.label) throw new Error('这个麦克风还没有显示名称。请先在浏览器设置中确认设备并允许访问，再刷新设备列表。');
  return { ...selected, isSystem: false };
}
