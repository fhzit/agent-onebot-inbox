/** Conservative, provider-specific OneBot action capability registry.
 * Capabilities describe known support only; they do not prove a live provider version.
 */
export type ProviderCapabilities = {
  provider: string;
  actions: ReadonlySet<string>;
};

const COMMON_V11_ACTIONS = [
  'send_private_msg', 'send_group_msg', 'delete_msg', 'get_msg',
  'get_login_info', 'get_stranger_info', 'get_friend_list', 'get_group_info', 'get_group_list',
  'get_group_member_info', 'get_group_member_list', 'get_file', 'get_status',
] as const;

const ACTION_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  get_group_member_list: ['get_group_member_list', 'get_group_member_list_v2'],
  get_group_member_list_v2: ['get_group_member_list', 'get_group_member_list_v2'],
  get_group_member_info: ['get_group_member_info', 'get_group_member_info_v2'],
  get_group_member_info_v2: ['get_group_member_info', 'get_group_member_info_v2'],
});

const REGISTRY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  napcat: COMMON_V11_ACTIONS,
  snowluma: COMMON_V11_ACTIONS,
});

/** Return only explicitly registered capabilities; unknown providers are not guessed. */
export function getProviderCapabilities(provider: string): ProviderCapabilities {
  const key = provider.trim().toLowerCase();
  return { provider: key, actions: new Set(REGISTRY[key] ?? []) };
}

/** Treat documented OneBot v11 action aliases as equivalent when checking support. */
export function providerSupportsAction(provider: string, action: string): boolean {
  const actions = getProviderCapabilities(provider).actions;
  const aliases = Object.hasOwn(ACTION_ALIASES, action) ? ACTION_ALIASES[action] : undefined;
  return (aliases ?? [action]).some(alias => actions.has(alias));
}
