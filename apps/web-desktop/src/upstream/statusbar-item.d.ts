declare module 'hermes:statusbar-item' {
  export const StatusbarItemView: import('react').ComponentType<{
    item: import('../../../desktop/src/app/shell/statusbar-controls').StatusbarItem
    navigate: ReturnType<typeof import('react-router').useNavigate>
  }>
}
