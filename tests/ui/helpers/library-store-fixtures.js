function createLibraryStoreFixtures() {
  return {
    windowsOnly: {
      id: 'windows-only',
      displayName: 'Windows Only Library',
      version: '1.0.0',
      supportedPlatforms: ['windows'],
      isDownloaded: true,
      isLoaded: false,
      isCore: false,
    },
    notDownloaded: {
      id: 'missing-library',
      displayName: 'Missing Library',
      version: '1.0.0',
      supportedPlatforms: ['linux'],
      isDownloaded: false,
      isLoaded: false,
      isCore: false,
    },
    allPlatform: {
      id: 'all-platform',
      displayName: 'All Platform Library',
      version: '1.0.0',
      supportedPlatforms: ['windows', 'macos', 'linux'],
      isDownloaded: true,
      isLoaded: true,
      isCore: false,
    },
  }
}

function createLibraryInfoFixture() {
  const base = {
    guid: '',
    version: '1.0.0',
    description: 'library store fixture',
    author: '',
    zipCode: '',
    address: '',
    phone: '',
    qq: '',
    email: '',
    homePage: '',
    otherInfo: '',
    fileName: '',
    commands: [],
    dataTypes: [],
    constants: [],
  }
  return {
    'windows-only': {
      ...base,
      name: 'windows-only',
    },
    'all-platform': {
      ...base,
      name: 'all-platform',
    },
    'missing-library': {
      ...base,
      name: 'missing-library',
    },
  }
}

module.exports = {
  createLibraryStoreFixtures,
  createLibraryInfoFixture,
}
