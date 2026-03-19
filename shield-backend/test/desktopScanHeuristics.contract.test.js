const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeDesktopScanPayload,
    requiresDesktopArtifactUpload
} = require('../src/utils/desktopScanHeuristics');

test('windows selective scan with coverage roots stays metadata-only', () => {
    const payload = normalizeDesktopScanPayload({
        platform: 'windows',
        mode: 'SELECTIVE',
        artifact_kind: 'FILESYSTEM',
        artifact_metadata: {
            target_name: 'DESKTOP-01',
            target_path: 'C:\\Windows\\System32',
            coverage_mode: 'smart-coverage',
            coverage_roots: [
                { path: 'C:\\Program Files', exists: true },
                { path: 'C:\\ProgramData', exists: true }
            ],
            install_roots: ['C:\\ProgramData\\Microsoft\\Windows\\Start Menu']
        }
    });

    assert.deepEqual(payload.artifactMetadata.scanRoots, ['C:\\Program Files', 'C:\\ProgramData']);
    assert.equal(requiresDesktopArtifactUpload(payload), false);
});

test('windows program scan in artifact mode stays metadata-only when coverage metadata is present', () => {
    const payload = normalizeDesktopScanPayload({
        platform: 'windows',
        mode: 'ARTIFACT',
        artifact_kind: 'ARTIFACT',
        artifact_metadata: {
            target_name: 'Acme App',
            target_path: 'C:\\Program Files\\Acme',
            coverage_mode: 'smart-coverage',
            scan_roots: ['C:\\Program Files\\Acme'],
            related_binary_roots: ['C:\\Program Files\\Acme\\bin'],
            metadata_roots: [{ path: 'metadata://windows/services' }]
        }
    });

    assert.equal(requiresDesktopArtifactUpload(payload), false);
});

test('explicit upload_required preserves desktop artifact upload flows', () => {
    const payload = normalizeDesktopScanPayload({
        platform: 'linux',
        mode: 'ARTIFACT',
        artifact_kind: 'EXECUTABLE',
        artifact_metadata: {
            target_name: 'sample.bin',
            target_path: '/tmp/sample.bin',
            upload_required: true
        }
    });

    assert.equal(requiresDesktopArtifactUpload(payload), true);
});
