window.COMMUNITY_PRIORITIES_CONFIG = {
  displayMode: "infrastructure",
  priorityCountLabel: "infrastructure priorities",
  databaseLayerLabel: "boundary layers",
  prioritiesGlobal: "INFRASTRUCTURE_PRIORITIES",
  filtersGlobal: "INFRASTRUCTURE_FILTERS",
  areaPhotosGlobal: "INFRASTRUCTURE_AREA_PHOTOS",
  areaPhotoRadiusMeters: 100,
  mapId: "cluster-priorities-only",
  includedLayerIds: ["boundary_cluster", "boundary_community"],
  navItems: [
    {
      id: "assets-community-priorities",
      label: "Assets and Community Priorities Old",
      href: "/"
    },
    {
      id: "cluster-priorities-only",
      label: "Cluster Priorities Only",
      href: "/cluster-priorities-map/map.htm"
    }
  ],
  priorityPhotoBaseUrl: "https://community-priorities-map-assets-974389254535-us-east-1.s3.us-east-1.amazonaws.com/community-priorities/priority-previews/",
  authApiBaseUrl: "https://tfqmwiadc8.execute-api.us-east-1.amazonaws.com",
  allowedAuthModules: ["clusters_map", "all"]
};