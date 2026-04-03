jest.mock('@/lib/api/client', () => ({
  getAuthHeaders: jest.fn(),
}));

jest.mock('expo-sharing', () => ({
  shareAsync: jest.fn(),
  isAvailableAsync: jest.fn(),
}));

const mockFileState = {
  exists: false,
  delete: jest.fn(),
  create: jest.fn(),
  write: jest.fn(),
  uri: 'file:///tmp/narae-export.json',
};

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Paths: { cache: '/tmp' },
}));

import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getAuthHeaders } from '@/lib/api/client';
import { deleteAccount, exportAccountData } from '@/lib/api/account';

const mockGetAuthHeaders = getAuthHeaders as jest.MockedFunction<typeof getAuthHeaders>;
const mockShareAsync = Sharing.shareAsync as jest.Mock;
const mockIsAvailableAsync = Sharing.isAvailableAsync as jest.Mock;
const MockFile = File as unknown as jest.Mock;

describe('account mobile API wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFileState.exists = false;
    mockFileState.delete.mockReset();
    mockFileState.create.mockReset();
    mockFileState.write.mockReset();
    global.fetch = jest.fn();
    mockGetAuthHeaders.mockResolvedValue({
      Authorization: 'Bearer test-token',
    });
    MockFile.mockImplementation(() => mockFileState);
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('exports account data to a temporary file and shares it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => '{"hello":"world"}',
    });

    await exportAccountData();

    expect(mockGetAuthHeaders).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/account'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
    expect(MockFile).toHaveBeenCalled();
    expect(mockFileState.create).toHaveBeenCalled();
    expect(mockFileState.write).toHaveBeenCalledWith('{"hello":"world"}');
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///tmp/narae-export.json',
      expect.objectContaining({
        mimeType: 'application/json',
      }),
    );
  });

  it('throws the API error when export fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Export refusé' }),
    });

    await expect(exportAccountData()).rejects.toThrow('Export refusé');
  });

  it('throws when file sharing is unavailable', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: async () => '{}',
    });
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(exportAccountData()).rejects.toThrow('Le partage de fichier n’est pas disponible sur cet appareil');
  });

  it('deletes the account through the account endpoint', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
    });

    await deleteAccount();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/account'),
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-token' },
      }),
    );
  });

  it('throws the API error when deletion fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Suppression refusée' }),
    });

    await expect(deleteAccount()).rejects.toThrow('Suppression refusée');
  });
});
