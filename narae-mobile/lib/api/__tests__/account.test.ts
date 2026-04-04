jest.mock('@/lib/api/client', () => ({
  fetchWithAuth: jest.fn(),
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
import { fetchWithAuth } from '@/lib/api/client';
import { deleteAccount, exportAccountData } from '@/lib/api/account';

const mockFetchWithAuth = fetchWithAuth as jest.MockedFunction<typeof fetchWithAuth>;
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
    MockFile.mockImplementation(() => mockFileState);
    mockIsAvailableAsync.mockResolvedValue(true);
    mockShareAsync.mockResolvedValue(undefined);
  });

  it('exports account data to a temporary file and shares it', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      text: async () => '{"hello":"world"}',
    } as Response);

    await exportAccountData();

    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining('/api/account'),
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
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Export refusé' }),
    } as Response);

    await expect(exportAccountData()).rejects.toThrow('Export refusé');
  });

  it('throws when file sharing is unavailable', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      text: async () => '{}',
    } as Response);
    mockIsAvailableAsync.mockResolvedValue(false);

    await expect(exportAccountData()).rejects.toThrow('Le partage de fichier n’est pas disponible sur cet appareil');
  });

  it('deletes the account through the account endpoint', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
    } as Response);

    await deleteAccount();

    expect(mockFetchWithAuth).toHaveBeenCalledWith(
      expect.stringContaining('/api/account'),
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('throws the API error when deletion fails', async () => {
    mockFetchWithAuth.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Suppression refusée' }),
    } as Response);

    await expect(deleteAccount()).rejects.toThrow('Suppression refusée');
  });
});
